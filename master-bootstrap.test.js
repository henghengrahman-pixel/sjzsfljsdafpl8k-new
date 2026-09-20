import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootstrapMaster } from '../src/db.js';

function existingMasterDb({username='old-admin', password='old-password', conflict=null}={}){
  const state={
    master:{id:'master-1',username,password_hash:bcrypt.hashSync(password,4),active:true,totp_secret:'KEEP-TOTP',totp_enrolled_at:new Date('2026-01-01')},
    updates:[]
  };
  return {
    state,
    async query(sql,args=[]){
      if(sql.includes("WHERE role=$1 ORDER BY created_at ASC LIMIT 1")) return {rows:[{id:state.master.id,username:state.master.username}]};
      if(sql.includes('WHERE username=$1 AND id<>$2')) return {rows:conflict?[conflict]:[]};
      if(sql.includes('UPDATE app_users')){
        state.master.username=args[1]; state.master.password_hash=args[2]; state.master.active=true;
        state.updates.push(args); return {rows:[]};
      }
      throw new Error('Unexpected SQL: '+sql);
    }
  };
}

test('existing master is synchronized from Railway env without resetting TOTP', async()=>{
  const db=existingMasterDb();
  const beforeSecret=db.state.master.totp_secret;
  const beforeEnrolled=db.state.master.totp_enrolled_at;
  await bootstrapMaster(db,{masterUsername:'admin',masterPassword:'new-password'});
  assert.equal(db.state.master.username,'admin');
  assert.equal(db.state.master.active,true);
  assert.equal(await bcrypt.compare('new-password',db.state.master.password_hash),true);
  assert.equal(await bcrypt.compare('old-password',db.state.master.password_hash),false);
  assert.equal(db.state.master.totp_secret,beforeSecret);
  assert.equal(db.state.master.totp_enrolled_at,beforeEnrolled);
  assert.equal(db.state.updates.length,1);
});

test('master sync refuses username collision', async()=>{
  const db=existingMasterDb({conflict:{id:'agent-2',role:'agent'}});
  await assert.rejects(
    bootstrapMaster(db,{masterUsername:'admin',masterPassword:'new-password'}),
    /MASTER_USERNAME 'admin' sudah dipakai akun lain/
  );
});
