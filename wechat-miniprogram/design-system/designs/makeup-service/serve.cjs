const http=require('http'),fs=require('fs'),path=require('path');
const types={'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css'};
http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const files={'/':'index.html','/index.html':'index.html','/work-detail.html':'work-detail.html','/work-detail-v2.html':'work-detail-v2.html','/reference-editorial.png':'reference-editorial.png','/mascot.png':'mascot.png','/tokens.css':'tokens.css'};
 if(!files[name]){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',types[path.extname(files[name])]);res.setHeader('Cache-Control','no-store');
 fs.createReadStream(path.join(__dirname,files[name])).pipe(res);
}).listen(9446,'127.0.0.1',()=>console.log('Design preview: http://127.0.0.1:9446'));
