let controller=null;
export async function api(url,options={}){const res=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let data={};try{data=await res.json()}catch{}if(!res.ok){const e=new Error(data.message||data.error||`HTTP_${res.status}`);e.code=data.error;e.status=res.status;throw e;}return data}
export async function apiCancelable(url){controller?.abort();controller=new AbortController();return api(url,{signal:controller.signal})}
