export function createConversationStore(){
  const s={selectedChatId:'',conversationMap:new Map(),orderedIds:[],messageMap:new Map(),connectionState:'RECONNECTING'};
  return {
    state:s,
    replace(items=[]){s.conversationMap=new Map(items.map(x=>[String(x.chat_id),x]));s.orderedIds=items.map(x=>String(x.chat_id));return this.items()},
    merge(items=[]){for(const x of items)s.conversationMap.set(String(x.chat_id),x);for(const x of items){const id=String(x.chat_id);if(!s.orderedIds.includes(id))s.orderedIds.push(id)}return this.items()},
    items(){return s.orderedIds.map(id=>s.conversationMap.get(id)).filter(Boolean)},
    get(id){return s.conversationMap.get(String(id))||null},
    upsert(item){const id=String(item.chat_id);s.conversationMap.set(id,{...(s.conversationMap.get(id)||{}),...item});if(!s.orderedIds.includes(id))s.orderedIds.push(id);return s.conversationMap.get(id)},
    select(id){s.selectedChatId=String(id||'');return s.selectedChatId},
    remove(id){id=String(id);s.conversationMap.delete(id);s.orderedIds=s.orderedIds.filter(x=>x!==id);if(s.selectedChatId===id)s.selectedChatId=''},
    reorder(ids){s.orderedIds=ids.filter(id=>s.conversationMap.has(String(id))).map(String);return this.items()}
  };
}
