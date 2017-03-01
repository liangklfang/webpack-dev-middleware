var http = require('http');
http.createServer(function(req,res){
	res.writeHead(200,{"Content-Type":"text/plain"});
	res.end('覃亮，你好');
	console.log('url=',req.url);
}).listen(1337,"localhost");