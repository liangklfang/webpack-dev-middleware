/*
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Tobias Koppers @sokra
 */
var mime = require("mime");
var getFilenameFromUrl = require("./lib/GetFilenameFromUrl");
var Shared = require("./lib/Shared");
var pathJoin = require("./lib/PathJoin");

// constructor for the middleware
/*
 webpack-dev-middleware第一个参数是我们的compiler,第二个参数是我们的devServer的配置
 */ 
module.exports = function(compiler, options) {
	var context = {
		state: false,
		//是否有这个'done'钩子函数的stats对象
		webpackStats: undefined,
		//接受compiler的'done'钩子函数返回的stats对象
		callbacks: [],
		//callback中传入的一个函数集合，每一个函数都有done钩子函数的stats
		//如果编译出错那么等待函数也在这集合中!
		options: options,
		//所有的其他配置都会被封装到compiler.options对象上
		compiler: compiler,
		watching: undefined,
		//调用compiler.watch方法返回的Watching对象，其中watchOptions原样传入watch方法
		forceRebuild: false
		//是否强制rebuild
	};
	var shared = Shared(context);
	// The middleware function
	// 我们这个webpack-dev-middleware其实是一个Express服务器中间件
	function webpackDevMiddleware(req, res, next) {
		function goNext() {
			if(!context.options.serverSideRender) return next();
			//如果不是serverSideRender直接放过
			shared.ready(function() {
				res.locals.webpackStats = context.webpackStats;
				//res.locals.webpackStats存放了我们的compiler.done钩子函数返回的Stats对象
				next();
			}, req);
		}
		//如果不是get方法直接调用goNext
		if(req.method !== "GET") {
			return goNext();
		}
		var filename = getFilenameFromUrl(context.options.publicPath, context.compiler.outputPath, req.url);
		//第一个是publicPath,第二个表示输出路径，第三个表示URL
		if(filename === false) return goNext();
		shared.handleRequest(filename, processRequest, req);
		//传入文件名,这个文件名是绝对路径。回调函数和request对象，用于处理lazy模式，在我们访问的时候才会编译!!!
		function processRequest() {
			try {
				var stat = context.fs.statSync(filename);
				//获取文件名
				if(!stat.isFile()) {
					if(stat.isDirectory()) {
						filename = pathJoin(filename, context.options.index || "index.html");
						//文件名
						stat = context.fs.statSync(filename);
						if(!stat.isFile()) throw "next";
					} else {
						throw "next";
					}
				}
			} catch(e) {
				return goNext();
			}

			// server content
			// 直接访问的是文件那么读取，如果是文件夹那么要访问文件夹
			var content = context.fs.readFileSync(filename);
			content = shared.handleRangeHeaders(content, req, res);
			res.setHeader("Access-Control-Allow-Origin", "*"); // To support XHR, etc.
			res.setHeader("Content-Type", mime.lookup(filename) + "; charset=UTF-8");
			res.setHeader("Content-Length", content.length);
			if(context.options.headers) {
				for(var name in context.options.headers) {
					res.setHeader(name, context.options.headers[name]);
				}
			}
			// Express automatically sets the statusCode to 200, but not all servers do (Koa).
			res.statusCode = res.statusCode || 200;
			if(res.send) res.send(content);
			else res.end(content);
		}
	}

	webpackDevMiddleware.getFilenameFromUrl = getFilenameFromUrl.bind(this, context.options.publicPath, context.compiler.outputPath);
	//从访问的req.url和publicPath并结合output.path来获取文件在output.path路径下的完整路径
	webpackDevMiddleware.waitUntilValid = shared.waitUntilValid;
	//等待有效，传入一个函数，如果当前编译还没有完成也就是没有compiler.done的stats对象那么直接讲回调函数放在数组中
	webpackDevMiddleware.invalidate = shared.invalidate;
	//无效,调用compiler.watch方法返回的Watching对象的invalidate方法
	webpackDevMiddleware.close = shared.close;
	//关闭,调用compiler.watch方法返回的Watching对象的close方法来完成不在监听文件变化
	webpackDevMiddleware.fileSystem = context.fs;
	//文件系统,该插件的fileSystem是fs
	return webpackDevMiddleware;
};
