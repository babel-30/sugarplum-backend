const session=require('express-session');
module.exports=class SQLiteSessionStore extends session.Store{
 constructor(db){super();this.db=db;}
 get(sid,cb){try{const r=this.db.prepare('SELECT * FROM admin_sessions WHERE sid=? AND expires_at>?').get(sid,Date.now());cb(null,r?JSON.parse(r.session_json):null);}catch(e){cb(e);}}
 set(sid,value,cb=()=>{}){try{this.db.prepare('INSERT OR REPLACE INTO admin_sessions VALUES(?,?,?)').run(sid,JSON.stringify(value),value.cookie?.expires?new Date(value.cookie.expires).getTime():Date.now()+86400000);cb();}catch(e){cb(e);}}
 destroy(sid,cb=()=>{}){try{this.db.prepare('DELETE FROM admin_sessions WHERE sid=?').run(sid);cb();}catch(e){cb(e);}}
 touch(sid,value,cb){this.set(sid,value,cb);}
};
