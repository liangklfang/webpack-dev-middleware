var parseRange = require("range-parser");
var pathIsAbsolute = require("path-is-absolute");
var MemoryFileSystem = require("memory-fs");
var HASH_REGEXP = /[0-9a-f]{10,}/;
/*
var context = {
		state: false,
		webpackStats: undefined,
		callbacks: [],
		options: options,
		compiler: compiler,
		watching: undefined,
		forceRebuild: false
	};
 可以传入下面参数:
 (1)watchOptions:
    aggregateTimeout:修改watchDelay

 (2)
 reporter:如何显示log形式

 log:console.log

 noInfo: // display no info to console (只显示warning和error)

 quite:// display nothing to the console

 warn:console.warn

 error:console.error

 watchDelay:监听的时间，用watchOptions.aggregateTimeout替换，默认200ms

 stats:格式化统计信息的选项
     context:默认是process.cwd
     others:也就是我们传入的如color等配置

lazy:不是watch模式，而是访问的时候自动编译
	*/
module.exports = function Shared(context) {
	var share = {
		//Options为我们为devServer添加的配置项，这里进行更新
		setOptions: function(options) {
			if(!options) options = {};
			if(typeof options.watchOptions === "undefined") options.watchOptions = {};
			//watchOptions
			if(typeof options.reporter !== "function") options.reporter = share.defaultReporter;
			//log展示方式
			if(typeof options.log !== "function") options.log = console.log.bind(console);
			//log默认使用console.log
			if(typeof options.warn !== "function") options.warn = console.warn.bind(console);
			//默认console.warn();
			if(typeof options.error !== "function") options.error = console.error.bind(console);
			//默认console.error
			if(typeof options.watchDelay !== "undefined") {
				// TODO remove this in next major version
				options.warn("options.watchDelay is deprecated: Use 'options.watchOptions.aggregateTimeout' instead");
				options.watchOptions.aggregateTimeout = options.watchDelay;
			}
			if(typeof options.watchOptions.aggregateTimeout === "undefined") options.watchOptions.aggregateTimeout = 200;
			if(typeof options.stats === "undefined") options.stats = {};
			//格式化统计信息
			if(!options.stats.context) options.stats.context = process.cwd();
			//options.stats.context
			if(options.lazy) {
				if(typeof options.filename === "string") {
					var str = options.filename
						.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
						.replace(/\\\[[a-z]+\\\]/ig, ".+");
					options.filename = new RegExp("^[\/]{0,1}" + str + "$");
				}
			}
			context.options = options;
			//重新更新options
		},
		//修改log显示的方式
		/*
		   传入类型：
		   {
					state: true,
					stats: stats,
					options: context.options
				}
		 */
		defaultReporter: function(reporterOptions) {
			var state = reporterOptions.state;
			var stats = reporterOptions.stats;
			var options = reporterOptions.options;
			if(state) {
				//compiler.done回调了就是true
				var displayStats = (!options.quiet && options.stats !== false);
				//quiet如果是false表示显示stats对象
				if(displayStats && !(stats.hasErrors() || stats.hasWarnings()) &&
					options.noInfo)
				 //display no info to console (only warnings and errors)
					displayStats = false;
				if(displayStats) {
					options.log(stats.toString(options.stats));
				}
				if(!options.noInfo && !options.quiet) {
					var msg = "Compiled successfully.";
					if(stats.hasErrors()) {
						msg = "Failed to compile.";
					} else if(stats.hasWarnings()) {
						msg = "Compiled with warnings.";
					}
					options.log("webpack: " + msg);
				}
			} else {
				options.log("webpack: Compiling...");
			}
		},

		//content是请求的文件内容
		//Range，是在 HTTP/1.1里新增的一个 header field，也是现在众多号称多线程下载工具（如 FlashGet、迅雷等）实现多线程下载的核心所在。
		handleRangeHeaders: function handleRangeHeaders(content, req, res) {
			//assumes express API. For other servers, need to add logic to access alternative header APIs
			res.setHeader("Accept-Ranges", "bytes");
			if(req.headers.range) {
				var ranges = parseRange(content.length, req.headers.range);
				//parseRange(size, header, options)
				// unsatisfiable
				if(-1 == ranges) {
					res.setHeader("Content-Range", "bytes */" + content.length);
					res.statusCode = 416;
				}

				// valid (syntactically invalid/multiple ranges are treated as a regular response)
				if(-2 != ranges && ranges.length === 1) {
					// Content-Range
					res.statusCode = 206;
					var length = content.length;
					res.setHeader(
						"Content-Range",
						"bytes " + ranges[0].start + "-" + ranges[0].end + "/" + length
					);

					content = content.slice(ranges[0].start, ranges[0].end + 1);
				}
			}
			return content;
		},
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
		},
		//文件资源已经都生产完成了
		compilerDone: function(stats) {
			// We are now on valid state
			context.state = true;
			context.webpackStats = stats;
			// Do the stuff in nextTick, because bundle may be invalidated
			// if a change happened while compiling
			process.nextTick(function() {
				// check if still in valid state
				if(!context.state) return;
				// print webpack output
				context.options.reporter({
					state: true,
					stats: stats,
					options: context.options
				});
				// execute callback that are delayed
				var cbs = context.callbacks;
				context.callbacks = [];
				cbs.forEach(function continueBecauseBundleAvailable(cb) {
					cb(stats);
				});
			});
			// In lazy mode, we may issue another rebuild
			if(context.forceRebuild) {
				context.forceRebuild = false;
				//在rebuild完成之前不能继续rebuild
				share.rebuild();
			}
		},
		/*
		  (1)显示log信息，同时state设置为false表示没有stats信息

		 */
		compilerInvalid: function() {
			if(context.state && (!context.options.noInfo && !context.options.quiet))
				context.options.reporter({
					state: false,
					options: context.options
				});
			// We are now in invalid state
			context.state = false;
			//resolve async
			if(arguments.length === 2 && typeof arguments[1] === "function") {
				var callback = arguments[1];
				callback();
			}
		},
		//调用share.ready(callback, {});如果有stats那么执行回调函数就可以了，回调函数传入我们编译时候产生的Stats
		ready: function ready(fn, req) {
			var options = context.options;
			if(context.state) return fn(context.webpackStats);
			if(!options.noInfo && !options.quiet)
				options.log("webpack: wait until bundle finished: " + (req.url || fn.name));
			//如果state为false表示没有编译完成或者编译出错需要再次编译，那么把回调函数传入集合后续调用
			context.callbacks.push(fn);
		},
	    //开始监听
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
		},

		//将state设置为false表示没有
		/*
		if(context.forceRebuild) {
				context.forceRebuild = false;
				share.rebuild();
			}
		 */
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

		//如果有错误，调用context.options.error，判断Error对象是否有stack和details属性
		handleCompilerCallback: function(err) {
			if(err) {
				context.options.error(err.stack || err);
				if(err.details) context.options.error(err.details);
			}
		},
		//filename是相对于output.path的绝对路径。在lazy模式下，没有filename那么我们直接rebuild
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
		},
		//等待bundle编译成功后调用，如果成功了继续调用
		waitUntilValid: function(callback) {
			callback = callback || function() {};
			share.ready(callback, {});
		},
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
		},
		//其实是调用webpack的compiler.watch方法返回的Watching对象的close方法完成
		close: function(callback) {
			callback = callback || function() {};
			if(context.watching) context.watching.close(callback);
			else callback();
		}
	};
	share.setOptions(context.options);
	//这里的option就是我们为devServer添加的参数对象，此时调用setOptions继续更新
	share.setFs(context.compiler);
    //处理第一个参数compilter
	context.compiler.plugin("done", share.compilerDone);
	//注册done函数
	context.compiler.plugin("invalid", share.compilerInvalid);
	//是否无效
	context.compiler.plugin("watch-run", share.compilerInvalid);
	context.compiler.plugin("run", share.compilerInvalid);
	//run,watch-run都是调用compilerInvalid回调,也就是lazy模式下我们每次调用后都会将watch-run,run设置为invalid
	share.startWatch();
	//开始监听
	return share;
};
