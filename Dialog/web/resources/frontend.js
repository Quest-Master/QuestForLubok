// Copyright 2019-2020 Linus Åkesson
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 	1. Redistributions of source code must retain the above copyright
// 	notice, this list of conditions and the following disclaimer.
//
// 	2. Redistributions in binary form must reproduce the above copyright
// 	notice, this list of conditions and the following disclaimer in the
// 	documentation and/or other materials provided with the distribution.
//
// 	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
// 	IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
// 	TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
// 	PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// 	HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// 	SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// 	LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// 	DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// 	THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// 	(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// 	OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

(function(){"use strict";

var b64_enc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
var b64_dec = [];

var toggles = [
	{id: "aacbf", text: "Fading text", init: true},
	{id: "aacbl", text: "Hyperlinks", init: true},
	{id: "aacbh", text: "Type on hover", init: false},
	{id: "aacbs", text: "Smooth scrolling", init: false},
	{id: "aacbn", text: "Night mode", init: false},
	{id: "aacba", text: "Always re-focus", init: false},
];

var aaengine;
var aatranscript;
var io;
var status;
var metadata;

for(var i = 0; i < b64_enc.length; i++) {
	b64_dec[b64_enc.charAt(i)] = i;
}

function decode_b64(data) {
	var array = new Uint8Array(data.length * 3 / 4);
	var i = 0, j = 0, b0, b1, b2, b3;
	while(i < data.length) {
		b0 = b64_dec[data.charAt(i++)];
		b1 = b64_dec[data.charAt(i++)];
		b2 = b64_dec[data.charAt(i++)];
		b3 = b64_dec[data.charAt(i++)];
		array[j++] = (b0 << 2) | (b1 >> 4);
		array[j++] = ((b1 & 15) << 4) | (b2 >> 2);
		array[j++] = ((b2 & 3) << 6) | b3;
	}
	if(b2 == 64) {
		array = array.slice(0, array.length - 2);
	} else if(b3 == 64) {
		array = array.slice(0, array.length - 1);
	}
	return array;
}

function encode_b64(data) {
	var str = "";
	var i = 0, j = 0, b0, b1, b2;
	while(i < data.length) {
		b0 = data[i++];
		str += b64_enc.charAt(b0 >> 2);
		if(i < data.length) {
			b1 = data[i++];
			str += b64_enc.charAt(((b0 & 3) << 4) | (b1 >> 4));
			if(i < data.length) {
				b2 = data[i++];
				str += b64_enc.charAt(((b1 & 15) << 2) | (b2 >> 6));
				str += b64_enc.charAt(b2 & 63);
			} else {
				str += b64_enc.charAt((b1 & 15) << 2) + "=";
			}
		} else {
			str += b64_enc.charAt((b0 & 3) << 4) + "==";
		}
	}
	return str;
}

function downloaddata(fname, filedata, is_url) {
	var blob;
	var url, elem;

	if(window.navigator && window.navigator.msSaveOrOpenBlob && !is_url) {
		blob = new Blob([filedata.buffer], {type: "application/octet-stream"});
		window.navigator.msSaveOrOpenBlob(blob, fname);
	} else {
		if(is_url) {
			url = filedata;
		} else {
			url = "data:application/octet-stream;base64," + encode_b64(filedata);
		}
		elem = document.createElement("a");
		elem.href = url;
		elem.setAttribute("download", fname);
		elem.innerHTML = "[click to download]";
		io.current.appendChild(elem);
		elem.click();
		io.current.removeChild(elem);
	}
}

function createdoc() {
	var top, outer, inner, btn, menu, list, line, cont, form, main, lbl, div, inp;

	top = document.getElementById("aacontainer");

	outer = document.createElement("div");
	outer.setAttribute("id", "aaouterstatus");
	top.appendChild(outer);

	btn = document.createElement("div");
	btn.setAttribute("id", "aamenubutton");
	outer.appendChild(btn);

	menu = document.createElement("div");
	menu.setAttribute("id", "aamenulines");
	btn.appendChild(menu);

	menu = document.createElement("div");
	menu.setAttribute("id", "aamenu");
	btn.appendChild(menu);

	list = document.createElement("div");
	list.setAttribute("id", "aamenulist");
	menu.appendChild(list);

	toggles.forEach(function(t) {
		lbl = document.createElement("label");
		lbl.setAttribute("for", t.id);
		div = document.createElement("div");
		inp = document.createElement("input");
		inp.setAttribute("class", "aacb");
		inp.setAttribute("id", t.id);
		inp.setAttribute("type", "checkbox");
		inp.checked = t.init;
		div.appendChild(inp);
		div.appendChild(document.createTextNode(t.text));
		lbl.appendChild(div);
		list.appendChild(lbl);
	});

	list.appendChild(document.createElement("hr"));

	cont = document.createElement("div");
	cont.setAttribute("id", "aaviewscript");
	cont.innerHTML = "View transcript";
	list.appendChild(cont);

	cont = document.createElement("div");
	cont.setAttribute("id", "aasavescript");
	cont.innerHTML = "Save transcript";
	list.appendChild(cont);

	cont = document.createElement("div");
	cont.setAttribute("id", "aarestart");
	cont.innerHTML = "Restart game";
	list.appendChild(cont);

	cont = document.createElement("div");
	cont.setAttribute("id", "aasavestory");
	cont.innerHTML = "Download story file";
	list.appendChild(cont);

	list.appendChild(document.createElement("hr"));

	cont = document.createElement("div");
	cont.setAttribute("id", "aaaboutopen");
	cont.innerHTML = "About";
	list.appendChild(cont);

	inner = document.createElement("div");
	inner.setAttribute("id", "aastatus");
	outer.appendChild(inner);

	outer = document.createElement("div");
	outer.setAttribute("id", "aastatusborder");
	top.appendChild(outer);

	outer = document.createElement("div");
	outer.setAttribute("id", "aaaboutouter");
	top.appendChild(outer);

	inner = document.createElement("div");
	inner.setAttribute("id", "aaaboutinner");
	outer.appendChild(inner);

	line = document.createElement("div");
	line.setAttribute("class", "aaaboutline");
	line.setAttribute("id", "aaaboutmeta");
	inner.appendChild(line);

	inner.appendChild(document.createElement("hr"));

	cont = document.createElement("a");
	cont.setAttribute("id", "aaaboutlink");
	cont.setAttribute("target", "_blank");
	cont.setAttribute("href", "https://linusakesson.net/dialog/aamachine/");
	cont.innerHTML = "&Aring;-machine web interpreter v0.5.3";
	line = document.createElement("div");
	line.setAttribute("class", "aaaboutline");
	line.appendChild(cont);
	inner.appendChild(line);

	inner.appendChild(document.createElement("hr"));

	cont = document.createElement("div");
	cont.setAttribute("class", "aailink");
	cont.setAttribute("id", "aaaboutclose");
	cont.innerHTML = "Close";
	line = document.createElement("div");
	line.setAttribute("class", "aaaboutline");
	line.appendChild(cont);
	inner.appendChild(line);

	form = document.createElement("form");
	form.setAttribute("id", "aaform");
	form.setAttribute("autocomplete", "off");
	top.appendChild(form);

	main = document.createElement("div");
	main.setAttribute("id", "aamain");
	main.setAttribute("aria-live", "polite");
	form.appendChild(main);

	div = document.createElement("div");
	div.setAttribute("id", "aascriptouter");
	form.appendChild(div);

	inner = document.createElement("textarea");
	inner.setAttribute("id", "aascriptinner");
	inner.readOnly = true;
	div.appendChild(inner);

	btn = document.createElement("div");
	btn.setAttribute("id", "aascriptclose");
	btn.innerHTML = "Close transcript";
	div.appendChild(btn);

	inp = document.createElement("input");
	inp.setAttribute("id", "aainput");
	inp.setAttribute("type", "text");
	inp.setAttribute("value", "");
	inp.setAttribute("autocomplete", "off");
	inp.setAttribute("spellcheck", "false");
	inp.setAttribute("autocorrect", "off");
	inp.setAttribute("aria-live", "off");
	main.appendChild(inp);

	outer = document.createElement("div");
	outer.setAttribute("id", "aaerrorouter");
	top.appendChild(outer);

	inner = document.createElement("div");
	inner.setAttribute("id", "aaaboutinner");
	outer.appendChild(inner);
	cont = document.createElement("div");
	cont.setAttribute("class", "aailink");
	cont.setAttribute("id", "aaerrorclose");
	cont.innerHTML = "Close";
	line = document.createElement("div");
	line.setAttribute("id", "aaerrorlog");
	inner.appendChild(line);
	line = document.createElement("div");
	line.setAttribute("class", "aaaboutline");
	line.appendChild(cont);
	inner.appendChild(line);
}

var aaremote = {
	enabled: false,
	up: false,
	serverpath: "",
	logtag: null,
	strpos: 0,
	servpos: 0,
	any_input: false,
	update: function() {
		var fname, now, dstr, tstr, pending, endpos;

		if(this.enabled && this.any_input) {
			if(!this.up) {
				now = new Date();
				dstr = now.getFullYear().toString().slice(2) + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
				tstr = ("0" + now.getHours()).slice(-2) + ("0" + now.getMinutes()).slice(-2);
				if(!this.logtag) {
					this.logtag = aaengine.get_metadata().title.replace(/[^a-zA-Z0-9]+/g, "-");
				}
				this.sessionid = this.logtag + "-" + dstr + "-" + tstr + "-" + Math.ceil(Math.random()*10000);
				this.up = true;
			}
			if(this.strpos < aatranscript.full.length) {
				if(aatranscript.full.length - this.strpos > 50000) {
					this.enabled = false;
				} else {
					pending = aatranscript.full.slice(this.strpos);
					endpos = aatranscript.full.length;
					$.ajax({
						type: "POST",
						url: this.serverpath,
						data: {
							data: {
								session: this.sessionid,
								text: pending,
								pos: this.servpos
							}
						},
						success: function(data) {
							if(endpos > aaremote.strpos) {
								aaremote.servpos = data;
								aaremote.strpos = endpos;
							}
						},
						error: function(c) {
							aaremote.enabled = false;
						}
					});
				}
			}
		}
	}
};

function prepare_styles(styles) {
	var sty, i, j, html = "";

	for(i = 0; i < styles.length; i++) {
		html += ".aalook" + i + " {";
		for(j in styles[i]) {
			html += j + ": " + styles[i][j] + ";";
		}
		html += "}\n";
	}
	sty = document.createElement("style");
	sty.innerHTML = html;
	return sty;
}

function errormsg(str) {
	var line;
	line = document.createElement("div");
	line.setAttribute("class", "aaerrorline");
	line.appendChild(document.createTextNode(str));
	document.getElementById("aaerrorlog").appendChild(line);
	document.getElementById("aaerrorouter").style.display = "block";
}

function scroll_to(anchor) {
	setTimeout(function() {
		var b =	document.getElementById("aacbs").checked? "smooth" : "auto";
		anchor.scrollIntoView({behavior: b, block: "start"});
	}, 1);
}

window.run_game = function(story64, options) {
	var storybytes = decode_b64(story64);

	if(options && options.aaLogServerPath) {
		aaremote.serverpath = options.aaLogServerPath;
		aaremote.logtag = options.aaLogTag;
		if(window.location.href.search('nofeedback') == -1) {
			aaremote.enabled = true;
		}
	}

	aatranscript = {
		did_line: false,
		did_par: false,
		full: "",
		disabled: false,
		line: function() {
			if(!this.did_par && !this.did_line && !this.disabled) {
				this.print("\n");
				this.did_line = true;
			}
		},
		par: function() {
			if(!this.did_par && !this.disabled) {
				if(!this.did_line) this.print("\n");
				this.print("\n");
				this.did_par = true;
			}
		},
		print: function(str) {
			if(!this.disabled) {
				this.full += str;
				this.did_line = false;
				this.did_par = false;
			}
		},
		restore: function(full) {
			this.full = full;
			this.did_line = false;
			this.did_par = false;
			this.disabled = false;
		},
	};

	io = {
		in_par: false,
		after_text: false,
		status_visible: false,
		in_status: false,
		old_inline: null,
		n_inner: 0,
		current: document.getElementById("aamain"),
		status_context: null,
		aainput: null,
		history: [],
		histpos: 0,
		protected_inp: "",
		transcript: aatranscript,
		viewing_script: false,
		sticky_focus: false,
		always_refocus: false,
		scroll_anchor: null,
		self_link_span: null,
		self_link_str: "",
		storage_key: null,
		mainarray: [],
		statusarray: null,
		currarray: [],
		divs: [],
		seen_index: 0,
		seen_divs: [],
		links_enabled: true,

		flush: function() {
		},
		reset: function() {
			this.status_visible = false;
			this.in_status = false;
			this.clear_all();
			this.transcript.par();
			this.scroll_anchor = null;
			this.divs = [];
			this.links_enabled = document.getElementById("aacbl").checked;
		},
		clear_all: function() {
			if(!this.in_status) {
				var div = document.getElementById("aastatus");
				$(div).empty();
				div.className = null;
				this.clear();
				this.statusarray = null;
			}
		},
		clear: function() {
			if(!this.in_status) {
				$(this.aainput).detach();
				this.scroll_anchor = null;
				this.current = document.getElementById("aamain");
				$(this.current).empty();
				this.in_par = false;
				this.after_text = false;
				this.n_inner = 0;
				this.transcript.par();
				this.mainarray = [];
				this.currarray = this.mainarray;
				this.old_inline = null;
				this.seen_index = 0;
				this.seen_divs = this.divs.slice();
			}
		},
		clear_links: function() {
			var i, array;

			['.aalink', '.aahidelink'].forEach(function(cl) {
				var list;

				list = $('#aamain ' + cl);
				list.off('mouseover click');
				list.removeClass(cl).addClass('aadeadlink');
				// 1 is a workaround because Safari doesn't retrigger the animation.
				if(1 || !document.getElementById("aacbf").checked || !io.links_enabled) {
					list.css("animation-name", "none");
					list.css("color", "inherit");
				}
			});
			array = this.mainarray;
			for(i = 0; i < array.length; i++) {
				if(array[i].t == "el" || array[i].t == "esl" || array[i].t == "erl") {
					array[i].t = "edl";
				} else if(array[i].t == "ll" || array[i].t == "lsl" || array[i].t == "lrl") {
					array[i].t = "ldl";
				} else if(array[i].t == "i") {
					array[i].t = "di";
				}
			}
		},
		clear_old: function() {
			var i, newpart, anchor;

			newpart = [];
			for(i = 0; i < io.seen_divs.length; i++) {
				newpart.push({t: "ed", i: io.seen_divs[i]});
			}
			newpart = newpart.concat(io.mainarray.slice(io.seen_index));
			io.reset();
			anchor = document.createElement("div");
			anchor.style.height = "0px";
			io.current.appendChild(anchor);
			io.scroll_anchor = anchor;
			io.transcript.disabled = true;
			io.replay_array(newpart);
			io.transcript.disabled = false;
		},
		clear_div: function() {
			var div, btndiv, p, span;

			if(!io.in_status) {
				div = io.current;
				while(div.nodeName == "P" || div.nodeName == "SPAN") {
					div = this.current.parentNode;
				}
				if(div.nodeName == "DIV") {
					div.style.display = "none";
					btndiv = document.createElement("div");
					$(btndiv).addClass("aareveal");
					span = document.createElement("span");
					span.style.cursor = "pointer";
					span.appendChild(document.createTextNode("+"));
					btndiv.appendChild(span);
					div.parentNode.insertBefore(btndiv, div);
					$(btndiv).on("click", function() {
						div.style.display = "block";
						btndiv.style.display = "none";
						return false;
					});
					io.scroll_anchor = btndiv;
					if(!document.getElementById("aacbf").checked) {
						btndiv.style["animation-name"] = "none";
					}
				}
				io.currarray.push({t: "cd"});
			}
		},
		leave_all: function() {
			this.current = document.getElementById("aamain");
			this.in_status = false;
			this.in_par = false;
			this.after_text = false;
			this.n_inner = 0;
			this.transcript.par();
			this.currarray = this.mainarray;
			this.currarray.push({t: "la"});
			this.divs = [];
		},
		ensure_par: function() {
			if(!this.in_par) {
				var p = document.createElement("p");
				if(this.after_text) {
					p.style["margin-top"] = "1em";
				}
				if(!document.getElementById("aacbf").checked) {
					p.style["animation-name"] = "none";
				}
				if(document.getElementById("aacbn").checked) {
					p.style.color = "#ccc";
				}
				this.current.appendChild(p);
				this.current = p;
				this.in_par = true;
				this.after_text = false;
			}
		},
		print: function(str) {
			this.ensure_par();
			this.current.appendChild(document.createTextNode(str));
			this.after_text = true;
			if(!this.in_status) {
				this.transcript.print(str);
			}
			if(this.self_link_span) {
				this.self_link_str += str.toLowerCase();
			}
			this.currarray.push({t: "t", s: str});
		},
		space: function() {
			this.print(" ");
			this.after_text = true;
		},
		space_n: function(n) {
			var span, i;
			this.ensure_par();
			span = document.createElement("span");
			span.className = "aaspacen";
			$(span).css("width", n + "ch");
			this.current.appendChild(span);
			this.after_text = true;
			if(!this.in_status) {
				for(i = 0; i < n; i++) {
					this.transcript.print(" ");
				}
			}
			if(this.self_link_span) {
				this.self_link_str += " ";
			}
			this.currarray.push({t: "sn", n: n});
		},
		leave_inner: function() {
			this.raw_unstyle();
			if(this.in_par) {
				this.current = this.current.parentNode;
				this.in_par = false;
			}
			this.after_text = false;
		},
		line: function() {
			if(this.in_par) {
				this.current.appendChild(document.createElement("br"));
			}
			if(!this.in_status) {
				this.transcript.line();
			}
			this.currarray.push({t: "l"});
		},
		par: function() {
			this.raw_unstyle();
			if(this.in_par) {
				this.current = this.current.parentNode;
				this.in_par = false;
			}
			if(!this.in_status) {
				this.transcript.par();
			}
			this.currarray.push({t: "p"});
		},
		print_input: function(str, link) {
			var span;

			this.scroll_anchor = this.current;
			if(link) {
				span = document.createElement("span");
				$(span).addClass(io.links_enabled? "aalink" : "aahidelink");
				span.href = "#0";
				span.role = "link";
				span.appendChild(document.createTextNode(str));
				this.current.appendChild(span);
				this.install_link(span, str);
			} else {
				this.current.appendChild(document.createTextNode(str));
			}
			this.transcript.print(str);
			this.transcript.line();
			this.current.style["margin-bottom"] = ".3em";
			this.after_text = false;
			this.leave_inner();
			this.currarray.push({t: "i", s: str});
		},
		setstyle: function(s) {
			var span;
			if(!this.in_status) {
				if(s & 2) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspanb";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
				if(s & 4) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspani";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
				if(s & 8) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspanf";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
			}
			this.currarray.push({t: "ss", s: s});
		},
		resetstyle: function(s) {
			var span;
			if(!this.in_status) {
				if(s & 2) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspanunb";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
				if(s & 4) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspanuni";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
				if(s & 8) {
					this.ensure_par();
					span = document.createElement("span");
					span.className = "aaspanunf";
					this.current.appendChild(span);
					this.current = span;
					this.n_inner++;
				}
			}
			this.currarray.push({t: "rs", s: s});
		},
		raw_unstyle: function() {
			while(this.n_inner) {
				this.current = this.current.parentNode;
				this.n_inner--;
			}
		},
		unstyle: function() {
			this.raw_unstyle();
			this.currarray.push({t: "us"});
		},
		enter_div: function(id) {
			var div, sty;

			this.leave_inner();
			div = document.createElement("div");
			div.className = "aalook" + id;
			this.current.appendChild(div);
			this.current = div;
			if(!this.in_status) {
				sty = io.styles[id]["margin-top"];
				if(sty && sty.length && sty.charAt(0) != '0') {
					this.transcript.par();
				} else {
					this.transcript.line();
				}
			}
			this.currarray.push({t: "ed", i: id});
			this.divs.push(id);
		},
		leave_div: function(id) {
			var sty;

			this.leave_inner();
			this.current = this.current.parentNode;
			if(!this.in_status) {
				sty = io.styles[id]["margin-bottom"];
				if(sty && sty.length && sty.charAt(0) != '0') {
					this.transcript.par();
				} else {
					this.transcript.line();
				}
			}
			this.currarray.push({t: "ld", i: id});
			this.divs.pop();
		},
		enter_span: function(id) {
			var span;
			if(this.in_status != 1) {
				this.raw_unstyle();
				this.ensure_par();
				span = document.createElement("span");
				span.className = "aalook" + id;
				this.current.appendChild(span);
				this.current = span;
			}
			this.currarray.push({t: "es", i: id});
		},
		leave_span: function() {
			if(this.in_status != 1) {
				this.current = this.current.parentNode;
			}
			this.currarray.push({t: "ls"});
		},
		enter_status: function(area, id) {
			this.leave_inner();
			if(!this.in_status) {
				var div;
				this.status_context = this.current;
				$(this.aainput).detach();
				if(area == 0) {
					div = document.getElementById("aastatus");
					$(div).empty();
					div.className = "aalook" + id;
					this.current = div;
					this.in_status = 1;
					this.statusarray = [{t: "est", i: id}];
					this.currarray = this.statusarray;
				} else {
					div = document.createElement("div");
					div.className = "aalook" + id;
					this.current.appendChild(div);
					this.current = div;
					this.in_status = 2;
					this.currarray.push({t: "eis", i: id});
					if(this.old_inline) {
						$(this.old_inline).detach();
					}
					this.old_inline = div;
				}
			}
		},
		leave_status: function() {
			this.leave_inner();
			if(this.in_status) {
				this.current = this.status_context;
				this.after_text = true;
				if(this.in_status == 1) {
					if(!this.status_visible) {
						document.getElementById("aastatus").style.display = "block";
						var b = document.getElementById("aastatusborder");
						b.style["animation-name"] = "fadein";
						b.style["animation-duration"] = ".9s";
						b.style["animation-delay"] = ".1s";
						this.status_visible = true;
					}
					this.currarray = this.mainarray;
				} else {
					this.currarray.push({t: "lis"});
				}
				this.in_status = false;
			}
		},
		install_link: function(span, str) {
			$(span).on("mouseover", function() {
				var old;
				if(status == aaengine.status.get_input && io.links_enabled && document.getElementById("aacbh").checked) {
					old = io.protected_inp;
					if(old && old.length && old[old.length - 1] != " ") old += " ";
					$(io.aainput).val(old + str);
				}
			});
			$(span).on("mouseout", function() {
				if(status == aaengine.status.get_input && io.links_enabled && document.getElementById("aacbh").checked) {
					$(io.aainput).val(io.protected_inp);
				}
			});
			$(span).on("click", function() {
				var old;
				if(!io.links_enabled || io.viewing_script) {
					return true;
				} else if(status == aaengine.status.get_input) {
					if(document.getElementById("aacbh").checked) {
						old = io.protected_inp;
						if(old && old.length && old[old.length - 1] != " ") old += " ";
					} else {
						old = "";
					}
					$(io.aainput).val(old + str);
					io.sticky_focus = false;
					$(io.aainput).submit();
				}
				return false;
			});
		},
		have_links: function() {
			return io.links_enabled;
		},
		enter_link: function(str) {
			var span;
			this.ensure_par();
			span = document.createElement("span");
			$(span).addClass(io.links_enabled? "aalink" : "aahidelink");
			span.href = "#0";
			span.role = "link";
			this.current.appendChild(span);
			this.install_link(span, str);
			this.current = span;
			this.currarray.push({t: "el", s: str});
		},
		leave_link: function() {
			this.current = this.current.parentNode;
			this.currarray.push({t: "ll"});
		},
		enter_self_link: function() {
			var span;
			this.ensure_par();
			span = document.createElement("span");
			$(span).addClass(io.links_enabled? "aalink" : "aahidelink");
			span.href = "#0";
			span.role = "link";
			this.current.appendChild(span);
			this.self_link_span = span;
			this.self_link_str = "";
			this.current = span;
			this.currarray.push({t: "esl"});
		},
		leave_self_link: function() {
			this.current = this.current.parentNode;
			this.install_link(this.self_link_span, this.self_link_str);
			this.self_link_span = null;
			this.currarray.push({t: "lsl"});
		},
		transform_url: function(url) {
			if(url.match(/^file:/i)) {
				return url.replace(/^file:/i, 'resources/');
			} else {
				return url;
			}
		},
		enter_link_res: function(res) {
			var a;

			this.ensure_par();
			a = document.createElement("a");
			$(a).addClass("aailink");
			a.href = this.transform_url(res.url);
			a.setAttribute("target", "_blank");
			this.current.appendChild(a);
			this.current = a;
			this.currarray.push({t: "erl", r: res});
		},
		leave_link_res: function() {
			this.current = this.current.parentNode;
			this.currarray.push({t: "lrl"});
		},
		embed_res: function(res) {
			var img;

			if(this.can_embed_res(res)) {
				this.ensure_par();
				img = document.createElement("img");
				img.src = this.transform_url(res.url);
				img.setAttribute("alt", res.alt);
				this.current.appendChild(img);
			} else {
				this.print("[");
				this.print(res.alt);
				this.print("]");
			}
			this.currarray.push({t: "er", r: res});
		},
		can_embed_res: function(res) {
			return !!res.url.match(/\.(png|jpe?g)$/i);
		},
		adjust_size: function() {
			var aamain, newheight;

			newheight = $(window).innerHeight() - $("#aaouterstatus").outerHeight() - 40;
			if(io.viewing_script) {
				aamain = $("#aascriptinner");
				newheight -= $("#aascriptclose").outerHeight();
			} else {
				aamain = $("#aamain");
			}
			newheight -= aamain.outerHeight(true) - aamain.innerHeight();
			aamain.height(newheight);
		},
		progressbar: function(p, total) {
			this.leave_inner();
			this.currarray.push({t: "pb", p: p, tot: total});
			p = p * 100 / total;
			if(p < 0) p = 0;
			if(p > 100) p = 100;
			var outer = $("<div/>").addClass("aaouterprogress").appendTo(this.current);
			$("<div/>").addClass("aaprogress").appendTo(outer).css("width", p + "%");
		},
		trace: function(str) {
		},
		script_on: function() {
			this.line();
			this.print("The web interpreter keeps a local transcript at all times. ");
			this.print("It can be downloaded from the menu in the top-right corner. ");
			this.print("The feature cannot be manually enabled or disabled.");
			this.line();
			return false;
		},
		script_off: function() {
		},
		save: function(filedata) {
			var fname, now, dstr, tstr;
			now = new Date();
			dstr = now.getFullYear().toString().slice(2) + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
			tstr = ("0" + now.getHours()).slice(-2) + ("0" + now.getMinutes()).slice(-2);
			fname = aaengine.get_metadata().title.replace(/[^a-zA-Z0-9]+/g, "-") + "-" + dstr + "-" + tstr + ".aasave";
			downloaddata(fname, filedata, false);
			return true;
		},
		restore: function() {
			var inp = document.createElement("input"), cancel = document.createElement("input");
			function bailout() {
				$(cancel).detach();
				if(status == aaengine.status.restore) {
					status = aaengine.vm_restore(null);
					io.activate_input();
				}
			}
			inp.setAttribute("type", "file");
			inp.setAttribute("accept", ".aasave");
			cancel.setAttribute("type", "button");
			cancel.setAttribute("value", "Cancel");
			$(inp).on("change", function(event) {
				var reader;
				if(event.target.files.length) {
					reader = new FileReader();
					reader.onload = function() {
						$(cancel).detach();
						if(status == aaengine.status.restore) {
							status = aaengine.vm_restore(new Uint8Array(reader.result));
							io.activate_input();
						}
					};
					reader.onabort = bailout;
					reader.onerror = bailout;
					reader.readAsArrayBuffer(event.target.files[0]);
				} else {
					bailout();
				}
			});
			$(cancel).on("click", function() {
				bailout();
			});
			$(this.aainput).detach();
			this.current.appendChild(inp);
			this.current.appendChild(cancel);
			inp.click();
			this.current.removeChild(inp);
		},
		activate_input: function() {
			var cfg, vmstate, autosave;

			if(typeof(Storage) !== "undefined") {
				vmstate = aaengine.async_save(status);
				cfg = {};
				toggles.forEach(function(t) {
					cfg[t.id] = document.getElementById(t.id).checked;
				});
				autosave = {
					vm: encode_b64(vmstate),
					ma: this.mainarray,
					sa: this.statusarray,
					script: this.transcript.full,
					undo: aaengine.get_undo_array().map(encode_b64),
					cfg: cfg
				};
				if(aaremote.up) {
					autosave.remsess = aaremote.sessionid;
					autosave.remservpos = aaremote.servpos;
					autosave.remstrpos = aaremote.strpos;
				}
				try {
					localStorage.setItem(aaengine.get_story_key(), JSON.stringify(autosave));
					this.reported_storage_err = false;
				} catch(e) {
					if(!this.reported_storage_err) {
						errormsg("Note: It wasn't possible to auto-save progress to local web storage.");
						errormsg("If you refresh the page or close the tab, the game will start over from the beginning.");
						errormsg("The in-game SAVE and RESTORE commands should still work.");
						this.reported_storage_err = true;
					}
				}
			}
			this.ensure_par();
			this.adjust_size();
			this.current.appendChild(this.aainput);
			$(this.aainput).val("");
			this.protected_inp = "";
			this.aainput.style.maxWidth = "100px";
			this.aainput.style.display = "inline-block";
			//$(this.aainput).val($(this.current).width() + ", " + $(this.aainput).position().left);
			this.aainput.style.maxWidth = ($(this.current).width() - $(this.aainput).position().left) + "px";
			aaremote.update();
			this.maybe_focus();
			if(status == aaengine.status.quit || status == aaengine.status.restore) {
				$(this.aainput).detach();
			}
		},
		maybe_focus: function() {
			if(this.sticky_focus || this.always_refocus) {
				this.aainput.focus();
			} else if(this.scroll_anchor) {
				scroll_to(this.scroll_anchor);
			} else {
				scroll_to(this.aainput);
			}
		},
		hist_add: function(str) {
			this.histpos = this.history.length;
			if(str && !(this.history.length && str == this.history[this.history.length - 1])) {
				this.history[this.histpos++] = str;
				if(this.history.length > 50) {
					this.history = this.history.slice(1);
					this.histpos--;
				}
			}
		},
		hist_up: function() {
			if(this.histpos) {
				$(this.aainput).val((this.protected_inp = this.history[--this.histpos]));
			}
		},
		hist_down: function() {
			if(this.histpos < this.history.length - 1) {
				$(this.aainput).val((this.protected_inp = this.history[++this.histpos]));
			} else if(this.histpos == this.history.length - 1) {
				$(this.aainput).val((this.protected_inp = ""));
				this.histpos++;
			}
		},
		replay_array: function(arr) {
			var i, e, t;

			for(i = 0; i < arr.length; i++) {
				e = arr[i];
				t = e.t;
				if(t == "t") {
					this.print(e.s);
				} else if(t == "l") {
					this.line();
				} else if(t == "p") {
					this.par();
				} else if(t == "sn") {
					this.space_n(e.n);
				} else if(t == "ed") {
					this.enter_div(e.i);
				} else if(t == "ld") {
					this.leave_div(e.i);
				} else if(t == "es") {
					this.enter_span(e.i);
				} else if(t == "ls") {
					this.leave_span();
				} else if(t == "la") {
					this.leave_all();
				} else if(t == "i") {
					this.print_input(e.s, true);
				} else if(t == "di") {
					this.print_input(e.s, false);
				} else if(t == "ss") {
					this.setstyle(e.s);
				} else if(t == "rs") {
					this.resetstyle(e.s);
				} else if(t == "us") {
					this.unstyle();
				} else if(t == "el") {
					this.enter_link(e.s);
				} else if(t == "ll") {
					this.leave_link();
				} else if(t == "esl") {
					this.enter_self_link();
				} else if(t == "lsl") {
					this.leave_self_link();
				} else if(t == "erl") {
					this.enter_link_res(e.r);
				} else if(t == "lrl") {
					this.leave_link_res();
				} else if(t == "er") {
					this.embed_res(e.r);
				} else if(t == "pb") {
					this.progressbar(e.p, e.tot);
				} else if(t == "cd") {
					this.clear_div();
				} else if(t == "est") {
					this.enter_status(0, e.i);
				} else if(t == "eis") {
					this.enter_status(1, e.i);
				} else if(t == "lis") {
					this.leave_status();
				} else if(t == "edl" || t == "ldl") {
				} else {
					console.log(e);
				}
			}
		}
	};

	createdoc();

	io.aainput = document.getElementById("aainput");

	$("#aainput").on('focus', function() {
		io.sticky_focus = true;
	});

	$("#aainput").on('input', function() {
		if(status == aaengine.status.get_key) {
			var str = $(io.aainput).val();
			io.leave_inner();
			io.after_text = true;
			status = aaengine.vm_proceed_with_key((str && str.length)? str.charCodeAt(0) : aaengine.keys.KEY_RETURN);
			io.activate_input();
		} else if(status == aaengine.status.get_input) {
			io.protected_inp = $(io.aainput).val();
		}
	});

	$("#aainput").on("keydown", function(code) {
		if(code.keyCode == 27) {
			io.aainput.blur();
		} else if(status == aaengine.status.get_input) {
			if(code.keyCode == 38) {
				io.hist_up();
				return false;
			} else if(code.keyCode == 40) {
				io.hist_down();
				return false;
			} else if(code.keyCode == 33) {
				var m = document.getElementById("aamain");
				m.scrollBy(0, -$(m).innerHeight() * .9);
				return false;
			} else if(code.keyCode == 34) {
				var m = document.getElementById("aamain");
				m.scrollBy(0, $(m).innerHeight() * .9);
				return false;
			}
		}
	});

	$("#aaform").on('submit', function() {
		var str = $(io.aainput).val();
		aaremote.any_input = true;
		if(status == aaengine.status.get_input) {
			io.hist_add(str);
			io.aainput.style.display = "none";
			io.print_input(str, true);
			if(!io.in_status) {
				io.seen_index = io.mainarray.length;
				io.seen_divs = io.divs.slice();
			}
			status = aaengine.vm_proceed_with_input(str);
			io.activate_input();
		} else if(status == aaengine.status.get_key) {
			io.leave_inner();
			io.after_text = true;
			io.scroll_anchor = null;
			if(!io.in_status) {
				io.seen_index = io.mainarray.length;
				io.seen_divs = io.divs.slice();
			}
			status = aaengine.vm_proceed_with_key((str && str.length)? str.charCodeAt(0) : aaengine.keys.KEY_RETURN);
			io.activate_input();
		}
		return false;
	});

	$(document).on("click", function() {
		document.getElementById("aamenu").style.display = "none";
		document.getElementById("aaaboutouter").style.display = "none";
	});

	$("#aamain").on("click", function() {
		var inp;
		document.getElementById("aamenu").style.display = "none";
		if(!document.getSelection().toString()) {
			inp = document.getElementById("aainput");
			if(inp) inp.focus();
		}
	});

	function update_night() {
		var ta = document.getElementById("aascriptinner");
		if(document.getElementById("aacbn").checked) {
			$("body").css("background-color", "#000");
			$("p").css("color", "#ccc");
			io.aainput.style.color = "#ccc";
			$("#aastatusborder").css("background-color", "#ccc");
			ta.style.backgroundColor = "#222";
			ta.style.color = "#ddd";
		} else {
			$("body").css("background-color", "#eee");
			$("p").css("color", "#000");
			io.aainput.style.color = "#000";
			$("#aastatusborder").css("background-color", "#000");
			ta.style.backgroundColor = "#ddd";
			ta.style.color = "#222";
		}
		io.maybe_focus();
	}

	function update_hyperlinks() {
		var en;

		en = document.getElementById("aacbl").checked;
		if(en != io.links_enabled) {
			io.links_enabled = en;
			if(en) {
				$(".aahidelink").removeClass("aahidelink").addClass("aalink");
				$(".aahidelink").attr("role", "link");
			} else {
				$(".aalink").removeClass("aalink").addClass("aahidelink");
				$(".aahidelink").removeAttr("role");
			}
		}
	}

	$("#aacbn").on("change", function() {
		update_night();
	});

	$("#aacbf").on("change", function() {
		io.maybe_focus();
	});

	$("#aacbl").on("change", function() {
		update_hyperlinks();
	});

	$("#aacba").on("change", function() {
		io.always_refocus = document.getElementById("aacba").checked;
		io.maybe_focus();
	});

	$("#aamenulines").on('click', function() {
		var menu = document.getElementById("aamenu");
		if(menu.style.display == "block") {
			menu.style.display = "none";
		} else {
			menu.style.display = "block";
		}
		if(window.getSelection) {
			window.getSelection().removeAllRanges();
		} else if(document.selection) {
			document.selection.empty();
		}
		return false;
	});

	$("#aarestart").on("click", function() {
		document.getElementById("aamenu").style.display = "none";
		$(this.aainput).detach();
		io.reset();
		status = aaengine.async_restart();
		io.activate_input();
		return false;
	});

	$("#aaviewscript").on("click", function() {
		var ta = document.getElementById("aascriptinner");
		document.getElementById("aamain").style.display = "none";
		document.getElementById("aascriptouter").style.display = "block";
		document.getElementById("aamenu").style.display = "none";
		ta.value = aatranscript.full;
		ta.scrollTop = ta.scrollHeight;
		io.viewing_script = true;
		io.adjust_size();
		return false;
	});

	$("#aascriptclose").on("click", function() {
		document.getElementById("aascriptouter").style.display = "none";
		document.getElementById("aascriptinner").value = "";
		document.getElementById("aamain").style.display = "block";
		document.getElementById("aamenu").style.display = "none";
		io.viewing_script = false;
		io.adjust_size();
		return false;
	});

	$("#aasavescript").on("click", function() {
		var fname, now, dstr, tstr;
		var bytes = [], i, ch;
		now = new Date();
		dstr = now.getFullYear().toString().slice(2) + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
		tstr = ("0" + now.getHours()).slice(-2) + ("0" + now.getMinutes()).slice(-2);
		fname = aaengine.get_metadata().title.replace(/[^a-zA-Z0-9]+/g, "-") + "-" + dstr + "-" + tstr + ".txt";
		for(i = 0; i < aatranscript.full.length; i++) {
			ch = aatranscript.full.charCodeAt(i);
			if(ch < 0x80) {
				bytes.push(ch);
			} else if(ch < 0x800) {
				bytes.push(0xc0 | (ch >> 6));
				bytes.push(0x80 | (ch & 0x3f));
			} else {
				bytes.push(0xe0 | (ch >> 12));
				bytes.push(0x80 | ((ch >> 6) & 0x3f));
				bytes.push(0x80 | (ch & 0x3f));
			}
		}
		document.getElementById("aamenu").style.display = "none";
		downloaddata(fname, new Uint8Array(bytes), false);
		return false;
	});

	$("#aasavestory").on("click", function() {
		var fname, elem;

		document.getElementById("aamenu").style.display = "none";
		fname = aaengine.get_metadata().title.replace(/[^a-zA-Z0-9]+/g, "-") + ".aastory";
		elem = document.createElement("a");
		elem.href = 'resources/' + fname;
		elem.setAttribute('download', fname);
		elem.setAttribute('target', '_blank');
		elem.innerHTML = "[click to download]";
		io.current.appendChild(elem);
		elem.click();
		io.current.removeChild(elem);
		return false;
	});

	$(window).resize(function() {
		io.adjust_size();
	});

	update_night();

	aaengine = window.aaengine;
	aaengine.prepare_story(storybytes, io, undefined, false, true, true);
	io.styles = aaengine.get_styles();
	io.storage_key = aaengine.get_story_key();
	document.getElementsByTagName("head")[0].appendChild(prepare_styles(io.styles));

	metadata = aaengine.get_metadata();
	var div = document.getElementById("aaaboutmeta");
	$(document).attr("title", metadata.title);
	div.appendChild(document.createTextNode(metadata.title));
	if(metadata.author) {
		div.appendChild(document.createElement("br"));
		div.appendChild(document.createTextNode(metadata.author));
	}
	div.appendChild(document.createElement("br"));
	div.appendChild(document.createTextNode("Release " + metadata.release));
	if(metadata.date) {
		div.appendChild(document.createTextNode(", " + metadata.date));
	}
	if(metadata.blurb) {
		div.appendChild(document.createElement("hr"));
		div.appendChild(document.createTextNode(metadata.blurb));
	}
	$("#aaaboutopen").on("click", function() {
		document.getElementById("aaaboutouter").style.display = "block";
		document.getElementById("aamenu").style.display = "none";
		return false;
	});
	$("#aaaboutclose").on("click", function() {
		document.getElementById("aaaboutouter").style.display = "none";
		return false;
	});
	$("#aaerrorclose, #aaerrorouter").on("click", function() {
		document.getElementById("aaerrorouter").style.display = "none";
		return false;
	});
	$("#aaaboutinner").on("click", function() {
		return false;
	});
	$("#aaaboutlink").on("click", function(e) {
		e.stopPropagation();
		return true;
	});

	var stored_state;
	try {
		stored_state = localStorage.getItem(io.storage_key);
		if(!stored_state) throw(0);
		stored_state = JSON.parse(stored_state);
		if(stored_state.cfg) {
			toggles.forEach(function(t) {
				if(typeof(stored_state.cfg[t.id] !== undefined)) {
					document.getElementById(t.id).checked = stored_state.cfg[t.id];
				}
			});
		}
		if(stored_state.remsess) {
			aaremote.sessionid = stored_state.remsess;
			aaremote.servpos = stored_state.remservpos || 0;
			aaremote.strpos = stored_state.remstrpos || 0;
			aaremote.up = true;
		}
		io.reset();
		aaengine.async_restore(decode_b64(stored_state.vm));
		io.reset();
		aaengine.set_undo_array(stored_state.undo.map(decode_b64));
		if(stored_state.sa) {
			io.replay_array(stored_state.sa);
			io.leave_status();
		}
		io.after_text = false;
		io.replay_array(stored_state.ma);
		io.transcript.restore(stored_state.script);
		status = aaengine.async_resume();
		scroll_to(io.current);
	} catch(e) {
		if(e != 0) console.log(e);
		status = aaengine.async_restart();
	}
	update_night();
	update_hyperlinks();
	io.scroll_anchor = null;
	io.activate_input();
};

})();
