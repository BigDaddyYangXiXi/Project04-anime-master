const http=require('http'),fs=require('fs'),path=require('path');
http.createServer((req,res)=>{
const url=new URL(req.url,'http://localhost'),file=path.resolve(__dirname,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
if(!file.startsWith(__dirname+path.sep)){res.writeHead(403);return res.end();}
fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end('Not found');}
res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.png':'image/png','.json':'application/json;charset=utf-8','.md':'text/plain;charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(b);});
}).listen(4321,'127.0.0.1',()=>console.log('http://127.0.0.1:4321/'));
