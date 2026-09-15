#!/usr/bin/env python3
import json, os, queue, socket, subprocess, tempfile, threading, time, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parents[1]
PORT=18777
CHROME_PORT=19222
CHATS=[
 {'chat_id':'A','customer_name':'Alpha','customer_email':'a@example.test','status':'active','handling_mode':'AI','last_event_at':'2026-09-15T08:00:01Z','last_message':'alpha hello','needs_reply':True},
 {'chat_id':'B','customer_name':'Beta','customer_email':'b@example.test','status':'active','handling_mode':'HUMAN','last_event_at':'2026-09-15T08:00:02Z','last_message':'beta help','needs_reply':True},
 {'chat_id':'C','customer_name':'Charlie','customer_email':'c@example.test','status':'active','handling_mode':'AI','last_event_at':'2026-09-15T08:00:03Z','last_message':'charlie ok','needs_reply':False},
]
MSGS={k:[{'id':i+1,'event_id':f'{k}-{i+1}','sender_type':'customer' if i%2==0 else 'ai','text':f'{k} message {i+1}','created_at':f'2026-09-15T08:00:{i+1:02d}Z','attachments':[]} for i in range(4)] for k in 'ABC'}
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def sendj(self,obj,status=200):
        b=json.dumps(obj).encode(); self.send_response(status); self.send_header('content-type','application/json'); self.send_header('content-length',str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u=urllib.parse.urlparse(self.path); p=u.path; q=urllib.parse.parse_qs(u.query)
        if p=='/api/me': return self.sendj({'ok':True,'user':'qa-admin'})
        if p=='/api/status': return self.sendj({'ok':True,'db':True,'brainDb':True,'livechatConfigured':True,'openaiConfigured':True,'systemEnabled':True,'poller':{'running':True},'cannedSync':{},'humanBridge':{'configured':True,'enabled':True},'integrationHealth':[{'integration':'livechat_poll','status':'OK'},{'integration':'telegram_poll','status':'OK'}]})
        if p=='/api/ops/health': return self.sendj({'ok':True})
        if p=='/api/conversations':
            items=list(CHATS); needle=(q.get('q',[''])[0] or '').lower(); fil=(q.get('filter',['ALL'])[0] or 'ALL').upper()
            if needle: items=[x for x in items if needle in x['customer_name'].lower() or needle in x['last_message'].lower()]
            if fil=='HUMAN': items=[x for x in items if x['handling_mode']=='HUMAN']
            if fil=='AI': items=[x for x in items if x['handling_mode']=='AI']
            if fil=='NEEDS_REPLY': items=[x for x in items if x['needs_reply']]
            return self.sendj({'ok':True,'items':items,'page':{'hasMore':False,'nextCursor':None}})
        if p.startswith('/api/canned/shortcut'):
            return self.sendj({'ok':True,'items':[{'source_id':'1','shortcut':'#halo','title':'Halo','content':'Halo bosku, ada yang bisa dibantu?'}]})
        if p.startswith('/api/conversations/'):
            parts=p.split('/'); cid=parts[3] if len(parts)>3 else ''
            c=next((x for x in CHATS if x['chat_id']==cid),None)
            if not c: return self.sendj({'ok':False,'error':'NOT_FOUND'},404)
            if p.endswith('/messages'):
                after=int(q.get('afterId',['0'])[0]); items=[m for m in MSGS[cid] if m['id']>after]
                return self.sendj({'ok':True,'chatId':cid,'conversation':c,'state':{'workflow_type':'QA','workflow_state':'READY'},'items':items})
            # Deliberate latency: A slowest to prove stale A cannot overwrite C.
            time.sleep({'A':0.45,'B':0.20,'C':0.03}.get(cid,0))
            items=MSGS[cid]
            return self.sendj({'ok':True,'chatId':cid,'conversation':c,'state':{'workflow_type':'QA','workflow_state':'READY'},'items':items,'messages':{'hasOlder':False,'beforeId':None,'lastId':items[-1]['id']}})
        if p=='/system-health': return self.file(ROOT/'public/pages/health.html','text/html')
        if p=='/health': return self.sendj({'ok':True,'service':'livechat-ai'})
        if p=='/' or p=='/login': return self.file(ROOT/'public/index.html','text/html')
        if p.startswith('/static/'):
            return self.file(ROOT/'public/assets'/p[len('/static/'):])
        if p.startswith('/'):
            f=ROOT/'public/pages'/(p.strip('/')+'.html')
            if f.exists(): return self.file(f,'text/html')
        self.send_error(404)
    def do_POST(self):
        p=urllib.parse.urlparse(self.path).path
        if p=='/api/logout' or p=='/api/session/touch': return self.sendj({'ok':True})
        if p.endswith('/takeover'):
            cid=p.split('/')[3]; next(x for x in CHATS if x['chat_id']==cid)['handling_mode']='HUMAN'; return self.sendj({'ok':True,'mode':'HUMAN'})
        if p.endswith('/enable-ai'):
            cid=p.split('/')[3]; next(x for x in CHATS if x['chat_id']==cid)['handling_mode']='AI'; return self.sendj({'ok':True,'mode':'AI'})
        if p.endswith('/end'):
            cid=p.split('/')[3]; next(x for x in CHATS if x['chat_id']==cid).update(status='closed'); return self.sendj({'ok':True})
        if p.endswith('/send'): return self.sendj({'ok':True,'sent':{'event_id':'sent-1'}})
        self.sendj({'ok':True})
    def file(self,path,ctype=None):
        if not path.exists(): return self.send_error(404)
        b=path.read_bytes(); ext=path.suffix.lower(); types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}
        self.send_response(200); self.send_header('content-type',ctype or types.get(ext,'application/octet-stream')); self.send_header('content-length',str(len(b))); self.end_headers(); self.wfile.write(b)

def wait_http(url,timeout=8):
    end=time.time()+timeout
    while time.time()<end:
        try: urllib.request.urlopen(url,timeout=.4).read(); return True
        except: time.sleep(.1)
    return False
class CDP:
    def __init__(self,wsurl):
        self.ws=websocket.create_connection(wsurl,timeout=5); self.i=0
    def call(self,method,params=None):
        self.i+=1; i=self.i; self.ws.send(json.dumps({'id':i,'method':method,'params':params or {}}))
        while True:
            r=json.loads(self.ws.recv())
            if r.get('id')==i:
                if 'error' in r: raise RuntimeError(r['error'])
                return r.get('result',{})
    def eval(self,expr): return self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True}).get('result',{}).get('value')

def main():
    srv=ThreadingHTTPServer(('127.0.0.1',PORT),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
    profile=tempfile.mkdtemp(prefix='lc8008-chrome-')
    chrome=subprocess.Popen(['chromium','--headless=new','--no-sandbox','--disable-gpu',f'--remote-debugging-port={CHROME_PORT}','--remote-allow-origins=*',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        if not wait_http(f'http://127.0.0.1:{CHROME_PORT}/json/version'): raise RuntimeError('chromium did not start')
        targets=json.load(urllib.request.urlopen(f'http://127.0.0.1:{CHROME_PORT}/json'))
        page=next(x for x in targets if x['type']=='page'); c=CDP(page['webSocketDebuggerUrl']); c.call('Page.enable'); c.call('Runtime.enable')
        results=[]
        for width,height in [(1920,1080),(1600,900),(1440,900),(1366,768),(1280,720)]:
            c.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
            c.call('Page.navigate',{'url':f'http://127.0.0.1:{PORT}/conversations'}); time.sleep(.8)
            geom=c.eval("({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,composer:!!document.querySelector('.composer-shell'),composerRect:document.querySelector('.composer-shell')?.getBoundingClientRect().toJSON(),errors:window.__qaErrors||[]})")
            results.append({'viewport':f'{width}x{height}','overflow':geom['sw']>geom['cw'],'composerVisible':bool(geom['composer'] and geom['composerRect']['bottom']<=height+1)})
        # Rapid A -> B -> C click. A response returns last; C must remain selected and rendered.
        c.call('Emulation.setDeviceMetricsOverride',{'width':1366,'height':768,'deviceScaleFactor':1,'mobile':False})
        c.call('Page.navigate',{'url':f'http://127.0.0.1:{PORT}/conversations'}); time.sleep(.7)
        c.eval("(()=>{const r=[...document.querySelectorAll('.chat-row')];r[0].click();setTimeout(()=>r[1].click(),20);setTimeout(()=>r[2].click(),40);return true})()")
        time.sleep(.8)
        rapid=c.eval("({name:document.querySelector('#chatName')?.textContent,session:document.querySelector('#chatSession')?.textContent,bubbles:[...document.querySelectorAll('.bubble .message-text')].map(x=>x.textContent)})")
        # Search during a deliberately busy list request by firing refresh then input.
        c.eval("(()=>{document.querySelector('#refreshChats').click();const i=document.querySelector('#chatSearch');i.value='Beta';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
        time.sleep(.6)
        search=c.eval("[...document.querySelectorAll('.chat-row .chat-title b')].map(x=>x.textContent)")
        # Canned must be absent until # is typed, then present.
        c.eval("document.querySelectorAll('.chat-row')[0]?.click()") ; time.sleep(.5)
        c.eval("document.querySelector('#takeoverBtn')?.click()") ; time.sleep(.5)
        c.eval("(()=>{const t=document.querySelector('#composerText');if(!t)return false;t.value='#h';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()") ; time.sleep(.4)
        canned=c.eval("({disabled:document.querySelector('#composerText')?.disabled,menuHidden:document.querySelector('#shortcutMenu')?.classList.contains('hidden'),items:document.querySelectorAll('.shortcut-item').length})")
        ok=all(not x['overflow'] and x['composerVisible'] for x in results) and rapid['session']=='C' and rapid['name']=='Charlie' and all(str(x).startswith('C message') for x in rapid['bubbles']) and search==['Beta'] and canned['items']>=1
        out={'ok':ok,'viewports':results,'rapidSwitch':rapid,'searchResult':search,'canned':canned}
        (ROOT/'audit-logs/browser-qa.json').write_text(json.dumps(out,indent=2))
        print(json.dumps(out,indent=2))
        if not ok: raise SystemExit(2)
    finally:
        srv.shutdown(); chrome.terminate();
        try: chrome.wait(timeout=3)
        except: chrome.kill()
if __name__=='__main__': main()
