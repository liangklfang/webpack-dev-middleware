### 1.lazy下请求到来的时候要rebuild

在lazy阶段我们不是调用compiler.watch方法，而是等待请求到来的时候我们才会编译。

```js
	startWatch: function() {
			var options = context.options;
			var compiler = context.compiler;
			// start watching
			if(!options.lazy) {
				var watching = compiler.watch(options.watchOptions, share.handleCompilerCallback);
				context.watching = watching;
				//context.watching得到原样返回的Watching对象
			} else {
			 //如果是lazy，表示我们不是watching监听，而是请求的时候才编译
				context.state = true;
			}
		}
```

调用rebuild的时候会判断context.state。每次重新编译后在compiler.done中会将context.state重置为true!

```js
 rebuild: function rebuild() {
			//如果没有通过compiler.done产生过Stats对象，那么我们设置forceRebuild为true
			//如果已经有Stats表明以前build过，那么我们调用run方法
			if(context.state) {
				context.state = false;
				context.compiler.run(share.handleCompilerCallback);
			} else {
				context.forceRebuild = true;
			}
		},
```

下面是当请求到来的时候我们继续编译。

```js
	handleRequest: function(filename, processRequest, req) {
			// in lazy mode, rebuild on bundle request
			if(context.options.lazy && (!context.options.filename || context.options.filename.test(filename)))
				share.rebuild();
			//如果filename里面有hash，那么我们通过fs从内存中读取文件名，同时回调就是直接发送消息到客户端!!!
			if(HASH_REGEXP.test(filename)) {
				try {
					if(context.fs.statSync(filename).isFile()) {
						processRequest();
						return;
					}
				} catch(e) {
				}
			}
			share.ready(processRequest, req);
			//回调函数将文件结果发送到客户端
		},
```

其中processRequest就是直接把资源发送到客户端:

```js
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

```

所以，在lazy模式下如果我们没有指定文件名filename，那么我们每次都是会重新rebuild的！但是如果指定了文件名，那么只有访问该文件名的时候才会rebuild!

### 2.如果资源无效我们调用compiler.watch方法返回的Watching对象的invalidate方法

```js
//invalidate传入一个回调函数，如果是watching模式，那么调用compiler.watch方法返回的Watching
		//对象的invalidate方法来完成
		invalidate: function(callback) {
			callback = callback || function() {};
			if(context.watching) {
				share.ready(callback, {});
				context.watching.invalidate();
			} else {
				callback();
			}
		}
```

### 3.调用compiler.watch方法返回的Watching对象的close方法来完成不在监听文件变化

```js
//其实是调用webpack的compiler.watch方法返回的Watching对象的close方法完成
		close: function(callback) {
			callback = callback || function() {};
			if(context.watching) context.watching.close(callback);
			else callback();
		}
```

### 4.该插件的compiler.outputFileSystem是一个MemoryFileSystem实例

```js
	webpackDevMiddleware.fileSystem = context.fs;
	setFs: function(compiler) {
			//compiler.outputPath必须提供一个绝对路径,其就是我们在output.path中配置的内容
			if(typeof compiler.outputPath === "string" && !pathIsAbsolute.posix(compiler.outputPath) && !pathIsAbsolute.win32(compiler.outputPath)) {
				throw new Error("`output.path` needs to be an absolute path or `/`.");
			}
			// store our files in memory
			var fs;
			var isMemoryFs = !compiler.compilers && compiler.outputFileSystem instanceof MemoryFileSystem;
			//是否是MemoryFileSystem实例
			if(isMemoryFs) {
				fs = compiler.outputFileSystem;
			} else {
				fs = compiler.outputFileSystem = new MemoryFileSystem();
			}
			context.fs = fs;
			//更新compiler.outputFileSystem
		}
```

### 5.如果是lazy模式下我们要通过publicPath,output.Path来获取到文件并发送

```js
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
```

如果资源已经完成编译那么我们直接发送，否则将回调函数放在集合中，等待完成后我们调用回调。

```js
	handleRequest: function(filename, processRequest, req) {
			// in lazy mode, rebuild on bundle request
			if(context.options.lazy && (!context.options.filename || context.options.filename.test(filename)))
				share.rebuild();
			//如果filename里面有hash，那么我们通过fs从内存中读取文件名，同时回调就是直接发送消息到客户端!!!
			if(HASH_REGEXP.test(filename)) {
				try {
					if(context.fs.statSync(filename).isFile()) {
						processRequest();
						return;
					}
				} catch(e) {
				}
			}
			share.ready(processRequest, req);
		}
```

### 6.等待bundle编译完成后我们才会执行某一个回调

```js
	waitUntilValid: function(callback) {
			callback = callback || function() {};
			share.ready(callback, {});
		}
```

### 7.webpack-dev-middleware也是通过compiler.watch来监听变化的，只是使用了MemoryFileSystem而已，进而提高了效率

```js
startWatch: function() {
			var options = context.options;
			var compiler = context.compiler;
			// start watching
			if(!options.lazy) {
				var watching = compiler.watch(options.watchOptions, share.handleCompilerCallback);
				context.watching = watching;
				//context.watching得到原样返回的Watching对象
			} else {
			 //如果是lazy，表示我们不是watching监听，而是请求的时候才编译
				context.state = true;
			}
		}
```

