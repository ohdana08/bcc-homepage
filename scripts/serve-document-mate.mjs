import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import documentMate from '../lib/document-mate/handler.js';
const root=path.resolve(new URL('../',import.meta.url).pathname);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.xml':'application/xml','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/document-mate'){
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>180000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      req.query=Object.fromEntries(url.searchParams);req.body=Buffer.concat(chunks).toString();res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};await documentMate(req,res);return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)||url.pathname.split('/').some(p=>p.startsWith('.'))){res.writeHead(403);res.end();return;}
    const info=await stat(file);const final=info.isDirectory()?path.join(file,'index.html'):file;
    res.setHeader('Content-Type',mime[path.extname(final)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(final));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(8898,'127.0.0.1',()=>console.log('Document Mate: http://127.0.0.1:8898/tools/document-mate/'));
