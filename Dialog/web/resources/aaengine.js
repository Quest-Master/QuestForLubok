// Copyright 2019-2022 Linus Åkesson
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

(function() {"use strict";

var HEAPFULL = 0x4001;
var AUXFULL = 0x4002;
var EXPECTOBJ = 0x4003;
var EXPECTBOUND = 0x4004;
var LTSFULL = 0x4006;
var IOSTATE = 0x4007;

if(!Uint8Array.prototype.slice) {
	Object.defineProperty(Uint8Array.prototype, "slice", {
		value: function(begin, end) {
			return new Uint8Array(Array.prototype.slice.call(this, begin, end));
		}
	});
}

if(!String.prototype.includes) {
	Object.defineProperty(String.prototype, "includes", {
		value: function(search, start) {
			if(typeof start !== 'number') start = 0;
		        if(start + search.length > this.length) return false;
		        return this.indexOf(search, start) !== -1;
		}
	});
}

if(!Uint8Array.prototype.includes) {
	Object.defineProperty(Uint8Array.prototype, "includes", {
		value: function(elem, start) {
			var i;
			if(typeof start !== 'number') start = 0;
			for(i = start; i < this.length; i++) {
				if(this[i] === elem) return true;
			}
			return false;
		}
	});
}

// parameter to vm_proceed_with_key:
var keys = {
	KEY_BACKSPACE:	8,
	KEY_RETURN:	13,
	KEY_UP:		16,
	KEY_DOWN:	17,
	KEY_LEFT:	18,
	KEY_RIGHT:	19
};

// return code from vm_run:
var status = {
	quit:		0,
	get_input:	1,
	get_key:	2,
	restore:	3,
};

function getfour(array, offset) {
	var out = "";
	var i;
	for(i = 0; i < 4; i++) {
		out += String.fromCharCode(array[offset + i]);
	}
	return out;
}

function get32(array, offset) {
	return (array[offset + 0] << 24) | (array[offset + 1] << 16) | (array[offset + 2] << 8) | array[offset + 3];
}

function get16(array, offset) {
	return (array[offset + 0] << 8) | array[offset + 1];
}

function putfour(array, offset, str) {
	var i;

	for(i = 0; i < 4; i++) {
		array[offset++] = str.charCodeAt(i);
	}
}

function put32(array, offset, value) {
	array[offset++] = (value >> 24) & 0xff;
	array[offset++] = (value >> 16) & 0xff;
	array[offset++] = (value >> 8) & 0xff;
	array[offset++] = (value >> 0) & 0xff;
	return offset;
}

function put16(array, offset, value) {
	array[offset++] = value >> 8;
	array[offset++] = value & 0xff;
	return offset;
}

function findchunk(filedata, name) {
	var size = get32(filedata, 4) + 8;
	var pos = 12, chname, chsize;
	while(pos < size) {
		chname = getfour(filedata, pos);
		chsize = get32(filedata, pos + 4);
		if(chname == name) {
			return filedata.slice(pos + 8, pos + 8 + chsize);
		}
		pos += 8 + ((chsize + 1) & ~1);
	}
	return null;
}

function tohex(v, len) {
	var str = v.toString(16);
	while(str.length < len) str = '0' + str;
	return str;
}

function decodechar(e, aach) {
	var entry, uchar;

	if(e.upper) {
		if(aach >= 0x61 && aach <= 0x7a) {
			aach ^= 0x20;
		} else if(aach >= 0x80) {
			aach = e.lang[e.extchars + 1 + (aach & 0x7f) * 5 + 1];
		}
		e.upper = false;
	}
	if(aach < 0x80) {
		return String.fromCharCode(aach);
	} else {
		aach &= 0x7f;
		if(aach >= e.lang[e.extchars]) {
			e.upper = false;
			return "??";
		} else {
			entry = e.extchars + 1 + aach * 5;
			uchar = (e.lang[entry + 2] << 16) | (e.lang[entry + 3] << 8) | e.lang[entry + 4];
			return String.fromCharCode(uchar);
		}
	}
}

function decodestr(e, addr) {
	var decoder = get16(e.lang, 0);
	var state = 0, code, bits = 0, nbit = 0, str = "";
	var i, len, charaddr, entry;

	while(true) {
		if(!nbit) {
			bits = e.writ[addr++];
			nbit = 8;
		}
		code = e.lang[decoder + (state << 1) + ((bits & 0x80) ? 1 : 0)];
		bits <<= 1;
		nbit--;
		if(code >= 0x81) {
			state = code & 0x7f;
		} else if(code == 0x80) {
			break;
		} else if(code == 0x5f) {
			code = 0;
			for(i = 0; i < e.esc_bits; i++) {
				if(!nbit) {
					bits = e.writ[addr++];
					nbit = 8;
				}
				code <<= 1;
				if(bits & 0x80) code |= 1;
				bits <<= 1;
				nbit--;
			}
			if(e.head[1] < 4) {
				str += decodechar(e, 0x80 + code);
			} else if(code < e.esc_boundary) {
				str += decodechar(e, 0xa0 + code);
			} else {
				str += " ";
				entry = 2 + (code - e.esc_boundary) * 3;
				len = e.dict[entry];
				charaddr = (e.dict[entry + 1] << 8) | e.dict[entry + 2];
				for(i = 0; i < len; i++) {
					str += decodechar(e, e.dict[charaddr + i]);
				}
			}
			state = 0;
		} else {
			str += decodechar(e, code + 0x20);
			state = 0;
		}
 
	}
	return str;
}

function prepare_story(file_array, io, seed, quit, toparea, inlinearea) {
	var e, i, stopptr, stopend;

	function findch(name, mandatory) {
		var data = findchunk(file_array, name);
		if(!data && mandatory) {
			throw 'Missing ' + name + ' chunk.';
		}
		return data;
	}

	function findfiles() {
		var size = get32(file_array, 4) + 8;
		var i;
		var pos = 12, chname, chsize, fname;
		var list = {};

		while(pos < size) {
			chname = getfour(file_array, pos);
			chsize = get32(file_array, pos + 4);
			if(chname == 'FILE') {
				fname = "";
				for(i = 0; file_array[pos + 8 + i]; i++) {
					fname += String.fromCharCode(file_array[pos + 8 + i]);
				}
				list[fname] = file_array.slice(pos + 8 + i + 1, pos + 8 + chsize);
			}
			pos += 8 + ((chsize + 1) & ~1);
		}

		return list;
	}

	if(getfour(file_array, 0) != "FORM" || getfour(file_array, 8) != "AAVM") {
		throw "Not an aastory file";
	}

	e = {
		SP_AUTO:	0,
		SP_NOSPACE:	1,
		SP_PENDING:	2,
		SP_SPACE:	3,
		SP_LINE:	4,
		SP_PAR:		5,

		head:		findch("HEAD", true),
		code:		findch("CODE", true),
		dict:		findch("DICT", true),
		init:		findch("INIT", true),
		lang:		findch("LANG", true),
		maps:		findch("MAPS", true),
		tags:		findch("TAGS", false),
		writ:		findch("WRIT", true),
		look:		findch("LOOK", true),
		meta:		findch("META", false),
		urls:		findch("URLS", false),
		files:		findfiles(),

		randomseed:	seed,
		strshift:	0,
		extchars:	0,
		esc_bits:	7,
		esc_boundary:	0,
		io:		io,
		stopchars:	[],
		nospcbefore:	[],
		nospcafter:	[],

		reg:		new Uint16Array(64),
		inst:		0,
		cont:		0,
		top:		0,
		env:		0,
		cho:		0,
		sim:		0xffff,
		aux:		0,
		trl:		0,
		sta:		0,
		stc:		0,
		cwl:		0,
		spc:		0,
		nob:		0,
		ltb:		0,
		ltt:		0,

		upper:		false,
		trace:		false,
		divs:		[],
		in_status:	false,
		n_statusdiv:	0,
		n_span:		0,
		n_link:		0,

		undodata:	[],
		pruned_undo:	false,
		havequit:	quit,
		havetop:	toparea,
		haveinline:	inlinearea,

		create_pair:	function(head, tail, e) {
			var addr = this.top;
			this.top += 2;
			if(this.top > this.env || this.top > this.cho) {
				throw HEAPFULL;
			}
			this.heapdata[addr + 0] = head;
			this.heapdata[addr + 1] = tail;
			return addr | 0xc000;
		}
	};

	if(e.head[0] != 0 || e.head[1] > 5) {
		throw "Unsupported aastory file format version (" + e.head[0] + "." + e.head[1] + ")";
	}
	if(e.head[2] != 2) {
		throw "Unsupported word size (" + e.head[2] + ")";
	}

	e.heapdata = new Uint16Array(get16(e.head, 16));
	e.auxdata = new Uint16Array(get16(e.head, 18));
	e.ramdata = new Uint16Array(get16(e.head, 20));
	e.strshift = e.head[3];
	e.extchars = get16(e.lang, 2);

	if(e.head[1] >= 4) {
		e.esc_boundary = e.lang[e.extchars] - 32;
		if(e.esc_boundary < 0) e.esc_boundary = 0;
		i = e.esc_boundary + get16(e.dict, 0) - 1;
		e.esc_bits = 0;
		while(i > 0) {
			i >>= 1;
			e.esc_bits++;
		}
	}

	stopptr = get16(e.lang, 6);
	stopend = stopptr;
	while(e.lang[stopend]) stopend++;
	e.stopchars = e.lang.slice(stopptr, stopend);
	if(e.head[1] >= 4) {
		stopptr = stopend + 1;
		stopend = stopptr;
		while(e.lang[stopend]) stopend++;
		e.nospcbefore = e.lang.slice(stopptr, stopend);
		stopptr = stopend + 1;
		stopend = stopptr;
		while(e.lang[stopend]) stopend++;
		e.nospcafter = e.lang.slice(stopptr, stopend);
	}

	vm_reinit(e);
	vm_reset(e, 0, true);
	e.initstate = vm_capture_state(e, 1);
	io.reset();

	return e;
}

function get_styles(e) {
	var styles = [];
	var n = get16(e.look, 0);
	var i, offs, map, str, c, colon, key;
	for(i = 0; i < n; i++) {
		offs = get16(e.look, 2 + i * 2);
		map = {};
		while(e.look[offs]) {
			str = "";
			while((c = e.look[offs++])) {
				str += String.fromCharCode(c);
			}
			colon = str.indexOf(":");
			if(colon > 0) {
				key = str.slice(0, colon++);
				while(str[colon] == ' ') colon++;
				map[key] = str.slice(colon);
			}
		}
		styles.push(map);
	}
	return styles;
}

function get_metadata(e) {
	var i, offs, key, ch, value;
	var result = {title: "Untitled story", release: get16(e.head, 4)};
	var keynames = ["title", "author", "noun", "blurb", "date", "compiler"];
	if(e.meta) {
		offs = 1;
		for(i = 0; i < e.meta[0]; i++) {
			key = e.meta[offs++];
			value = "";
			while((ch = e.meta[offs++])) {
				value += decodechar(e, ch);
			}
			if(key >= 1 && key <= keynames.length) {
				result[keynames[key - 1]] = value;
			}
		}
	}
	return result;
}

function vm_reinit(e) {
	var i;

	e.nob = get16(e.init, 0);
	e.ltb = get16(e.init, 2);
	e.ltt = get16(e.init, 4);
	for(i = 0; i < e.heapdata.length; i++) {
		e.heapdata[i] = 0x3f3f;
	}
	for(i = 0; i < e.auxdata.length; i++) {
		e.auxdata[i] = 0x3f3f;
	}
	for(i = (e.init.length - 6) >> 1; i < e.ramdata.length; i++) {
		e.ramdata[i] = 0x3f3f;
	}
	for(i = 6; i < e.init.length; i += 2) {
		e.ramdata[(i - 6) >> 1] = get16(e.init, i);
	}
}

function vm_reset(e, arg0, clear_undo) {
	var i;
	e.reg[0] = arg0;
	for(i = 1; i < 64; i++) {
		e.reg[i] = 0;
	}
	e.inst = 1;
	e.cont = 0;
	e.top = 0;
	e.env = e.heapdata.length;
	e.cho = e.heapdata.length;
	e.sim = 0xffff;
	e.aux = 0;
	e.trl = e.auxdata.length;
	e.sta = 0;
	e.stc = 0;
	e.cwl = 0;
	e.spc = e.SP_LINE;
	e.divs = [];
	e.upper = false;
	e.in_status = false;
	if(clear_undo) {
		e.undodata = [];
		e.pruned_undo = false;
	}
	e.randomstate = e.randomseed? e.randomseed : Date.now();
}

function vm_capture_state(e, new_inst) {
	var nword = 3 + e.ramdata.length + e.auxdata.length + e.heapdata.length;
	var data = new Uint8Array(nword * 2);
	var regs = new Uint8Array(128 + 26 + 2 + e.divs.length * 2);
	var i, j = 0;

	j = put16(data, j, e.nob);
	j = put16(data, j, e.ltb);
	j = put16(data, j, e.ltt);
	for(i = 0; i < e.ramdata.length; i++) {
		j = put16(data, j, i < e.ltt ? e.ramdata[i] : 0x3f3f);
	}
	for(i = 0; i < e.auxdata.length; i++) {
		j = put16(data, j, (i < e.aux || i >= e.trl) ? e.auxdata[i] : 0x3f3f);
	}
	for(i = 0; i < e.heapdata.length; i++) {
		j = put16(data, j, (i < e.top || i >= e.env || i >= e.cho) ? e.heapdata[i] : 0x3f3f);
	}

	j = 0;
	for(i = 0; i < 64; i++) {
		j = put16(regs, j, e.reg[i]);
	}
	j = put32(regs, j, new_inst);
	j = put32(regs, j, e.cont);
	j = put16(regs, j, e.top);
	j = put16(regs, j, e.env);
	j = put16(regs, j, e.cho);
	j = put16(regs, j, e.sim);
	j = put16(regs, j, e.aux);
	j = put16(regs, j, e.trl);
	j = put16(regs, j, e.sta);
	j = put16(regs, j, e.stc);
	regs[j++] = e.cwl;
	regs[j++] = e.spc;
	j = put16(regs, j, e.divs.length);
	for(i = 0; i < e.divs.length; i++) {
		j = put16(regs, j, e.divs[i]);
	}

	return {data: data, regs: regs};
}

function vm_clear_divs(e) {
	e.io.leave_all();
	e.in_status = false;
	e.n_span = 0;
	e.n_link = 0;
	e.divs = [];
}

function vm_restore_state(e, state) {
	var data = state.data, regs = state.regs;
	var i, j = 0, ndiv;

	e.nob = get16(data, j); j += 2;
	e.ltb = get16(data, j); j += 2;
	e.ltt = get16(data, j); j += 2;
	for(i = 0; i < e.ramdata.length; i++) {
		e.ramdata[i] = get16(data, j); j += 2;
	}
	for(i = 0; i < e.auxdata.length; i++) {
		e.auxdata[i] = get16(data, j); j += 2;
	}
	for(i = 0; i < e.heapdata.length; i++) {
		e.heapdata[i] = get16(data, j); j += 2;
	}

	j = 0;
	for(i = 0; i < 64; i++) {
		e.reg[i] = get16(regs, j); j += 2;
	}
	e.inst = get32(regs, j); j += 4;
	e.cont = get32(regs, j); j += 4;
	e.top = get16(regs, j); j += 2;
	e.env = get16(regs, j); j += 2;
	e.cho = get16(regs, j); j += 2;
	e.sim = get16(regs, j); j += 2;
	e.aux = get16(regs, j); j += 2;
	e.trl = get16(regs, j); j += 2;
	e.sta = get16(regs, j); j += 2;
	e.stc = get16(regs, j); j += 2;
	e.cwl = regs[j++];
	e.spc = regs[j++];
	ndiv = get16(regs, j); j += 2;
	for(i = 0; i < ndiv; i++) {
		e.divs[i] = get16(regs, j); j += 2;
		e.io.enter_div(e.divs[i]);
	}
}

function vm_rlenc_state(reference, state) {
	var i, j = 0, bytes = 0, nz = 0, encoded, diff;

	for(i = 0; i < reference.data.length; i++) {
		if(reference.data[i] ^ state.data[i]) {
			bytes++;
			nz = 0;
		} else {
			if(nz && nz < 0x100) {
				nz++;
			} else {
				bytes += 2;
				nz = 1;
			}
		}
	}

	encoded = new Uint8Array(bytes);
	for(i = 0; i < reference.data.length; i++) {
		diff = reference.data[i] ^ state.data[i];
		if(diff) {
			encoded[j++] = diff;
		} else {
			encoded[j++] = 0;
			nz = 1;
			while(nz < 0x100 && !(reference.data[i + nz] ^ state.data[i + nz])) {
				nz++;
			}
			encoded[j++] = nz - 1;
			i += nz - 1;
		}
	}

	return {rledata: encoded, regs: state.regs};
}

function vm_rldec_state(reference, encoded) {
	var array = new Uint8Array(reference.data.length);
	var i, j = 0, diff, nz;

	for(i = 0; i < encoded.rledata.length; i++) {
		diff = encoded.rledata[i];
		if(diff) {
			array[j] = reference.data[j] ^ diff;
			j++;
		} else {
			nz = encoded.rledata[++i] + 1;
			while(nz--) {
				array[j] = reference.data[j];
				j++;
			}
		}
	}

	return {data: array, regs: encoded.regs};
}

function vm_wrap_savefile(e, encoded) {
	function makechunk(tag, array) {
		var size = (array.length + 1) & ~1;
		var result = new Uint8Array(8 + size);
		putfour(result, 0, tag);
		put32(result, 4, array.length);
		result.set(array, 8);
		return result;
	}

	var head = makechunk("HEAD", e.head);
	var data = makechunk("DATA", encoded.rledata);
	var regs = makechunk("REGS", encoded.regs);
	var size = 4 + head.length + data.length + regs.length;
	var result = new Uint8Array(8 + size);

	putfour(result, 0, "FORM");
	put32(result, 4, size);
	putfour(result, 8, "AASV");
	result.set(head, 12);
	result.set(data, 12 + head.length);
	result.set(regs, 12 + head.length + data.length);

	return result;
}

function vm_unwrap_savefile(e, filedata) {
	var head, data, regs, i;

	if(getfour(filedata, 0) != "FORM" || getfour(filedata, 8) != "AASV") {
		e.io.print("Not an aasave file!");
		e.io.line();
		return null;
	}
	head = findchunk(filedata, "HEAD");
	data = findchunk(filedata, "DATA");
	regs = findchunk(filedata, "REGS");
	if(!head || !data || !regs) {
		e.io.print("Incomplete aasave file!");
		e.io.line();
		return null;
	}
	for(i = 0; i < head.length && i < e.head.length; i++) {
		if(head[i] != e.head[i]) break;
	}
	if(i != head.length || i != e.head.length) {
		e.io.print("This savefile is from another story (or another version of the present story).");
		e.io.line();
		return null;
	}
	return {rledata: data, regs: regs};
}

function vm_run(e, param) {
	var io = e.io;
	var op, a1, a2, a3, a4, addr, tmp, v, i, j, flag, iter, match, curr, str;

	function fvalue() {
		var v = e.code[e.inst++];
		if(v >= 0xc0) {
			return e.heapdata[e.env + 4 + (v & 0x3f)];
		} else if(v >= 0x80) {
			return e.reg[v & 0x3f];
		} else {
			return (v << 8) | e.code[e.inst++];
		}
	}

	function findex() {
		var v = e.code[e.inst++];
		if(v >= 0xc0) {
			return ((v & 0x3f) << 8) | e.code[e.inst++];
		} else {
			return v;
		}
	}

	function fcode() {
		var v = e.code[e.inst++];
		if(v == 0) {
			return 0;
		} else if(v < 0x40) {
			return e.inst + v;
		} else if(v < 0x80) {
			v = ((v & 0x3f) << 8) | e.code[e.inst++];
			if(v & 0x2000) {
				return e.inst + v - 0x4000;
			} else {
				return e.inst + v;
			}
		} else {
			v = ((v & 0x7f) << 16) | (e.code[e.inst++] << 8);
			return v | e.code[e.inst++];
		}
	}

	function fstring() {
		var v = e.code[e.inst++];
		if(v >= 0xc0) {
			v = ((v & 0x3f) << 16) | (e.code[e.inst++] << 8);
			v |= e.code[e.inst++];
			return v << e.strshift;
		} else if(v >= 0x80) {
			v = ((v & 0x3f) << 8) | e.code[e.inst++];
			return v << e.strshift;
		} else {
			return v << 1;
		}
	}

	function fword() {
		var v = e.code[e.inst++];
		return (v << 8) | e.code[e.inst++];
	}

	function deref(v) {
		var t;

		while((v & 0xe000) == 0x8000) {
			t = e.heapdata[v & 0x1fff];
			if(!t) return v;
			v = t;
		}
		return v;
	}

	function fail() {
		e.inst = (e.heapdata[e.cho + 4] << 16) | e.heapdata[e.cho + 5];
	}

	function unify(a, b) {
		while(true) {
			a = deref(a);
			b = deref(b);
			if((a & 0xe000) == 0x8000 && (b & 0xe000) == 0x8000) {
				if(e.trl <= e.aux) throw AUXFULL;
				if(a < b) {
					e.auxdata[--e.trl] = b & 0x1fff;
					e.heapdata[b & 0x1fff] = a;
				} else if(a > b) {
					e.auxdata[--e.trl] = a & 0x1fff;
					e.heapdata[a & 0x1fff] = b;
				}
				return true;
			} else if((a & 0xe000) == 0x8000) {
				if(e.trl <= e.aux) throw AUXFULL;
				e.auxdata[--e.trl] = a & 0x1fff;
				e.heapdata[a & 0x1fff] = b;
				return true;
			} else if((b & 0xe000) == 0x8000) {
				if(e.trl <= e.aux) throw AUXFULL;
				e.auxdata[--e.trl] = b & 0x1fff;
				e.heapdata[b & 0x1fff] = a;
				return true;
			} else if(a >= 0xe000 && b >= 0xe000) {
				a = e.heapdata[a & 0x1fff];
				b = e.heapdata[b & 0x1fff];
			} else if(a >= 0xe000) {
				a = e.heapdata[a & 0x1fff];
			} else if(b >= 0xe000) {
				b = e.heapdata[b & 0x1fff];
			} else if(a == b) {
				return true;
			} else if(a >= 0xc000 && b >= 0xc000) {
				if(!unify(a - 0x4000, b - 0x4000)) return false;
				a = a - 0x3fff;
				b = b - 0x3fff;
			} else {
				return false;
			}
		}
	}

	function would_unify(a, b) {
		while(true) {
			a = deref(a);
			b = deref(b);
			if((a & 0xe000) == 0x8000 || (b & 0xe000) == 0x8000) {
				return true;
			} else if(a >= 0xe000 && b >= 0xe000) {
				a = e.heapdata[a & 0x1fff];
				b = e.heapdata[b & 0x1fff];
			} else if(a >= 0xe000) {
				a = e.heapdata[a & 0x1fff];
			} else if(b >= 0xe000) {
				b = e.heapdata[b & 0x1fff];
			} else if(a == b) {
				return true;
			} else if(a >= 0xc000 && b >= 0xc000) {
				if(!would_unify(a - 0x4000, b - 0x4000)) {
					return false;
				}
				a = a - 0x3fff;
				b = b - 0x3fff;
			} else {
				return false;
			}
		}
	}

	function destvalue(dest) {
		if(dest & 0x40) {
			return e.heapdata[e.env + 4 + (dest & 0x3f)];
		} else {
			return e.reg[dest & 0x3f];
		}
	}

	function store(dest, src) {
		//console.log(tohex(src, 4));
		if(dest >= 0xc0) {
			if(!unify(e.heapdata[e.env + 4 + (dest & 0x3f)], src)) fail();
		} else if(dest >= 0x80) {
			if(!unify(e.reg[dest & 0x3f], src)) fail();
		} else if(dest >= 0x40) {
			e.heapdata[e.env + 4 + (dest & 0x3f)] = src;
		} else {
			e.reg[dest] = src;
		}
	}

	function push_cho(narg, next) {
		var i;
		var addr = ((e.env < e.cho) ? e.env : e.cho) - 9 - narg;
		if(addr < e.top) throw HEAPFULL;
		e.heapdata[addr + 0] = e.env;
		e.heapdata[addr + 1] = e.sim;
		e.heapdata[addr + 2] = e.cont >> 16;
		e.heapdata[addr + 3] = e.cont & 0xffff;
		e.heapdata[addr + 4] = next >> 16;
		e.heapdata[addr + 5] = next & 0xffff;
		e.heapdata[addr + 6] = e.cho;
		e.heapdata[addr + 7] = e.top;
		e.heapdata[addr + 8] = e.trl;
		for(i = 0; i < narg; i++) {
			e.heapdata[addr + 9 + i] = e.reg[i];
		}
		e.cho = addr;
	}

	function push_aux(v) {
		var count;

		v = deref(v);
		if(v >= 0xe000) {
			push_aux(e.heapdata[(v & 0x1fff) + 1]);
			push_aux(e.heapdata[(v & 0x1fff) + 0]);
			v = 0x8100;
		} else if(v >= 0xc000) {
			count = 0;
			while(true) {
				push_aux(v - 0x4000);
				count++;
				v = deref(v - 0x3fff);
				if(v == 0x3f00) {
					v = 0xc000 | count;
					break;
				} else if((v & 0xe000) != 0xc000) {
					push_aux(v);
					v = 0xe000 | count;
					break;
				}
			}
		} else if(v >= 0x8000) {
			v = 0x8000;
		}
		if(e.aux >= e.trl) throw AUXFULL;
		e.auxdata[e.aux++] = v;
	}

	function pop_aux() {
		var v = e.auxdata[--e.aux];
		var addr, count;

		if(v == 0x8000) {
			addr = e.top++;
			if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
			e.heapdata[addr] = 0;
			v = 0x8000 | addr;
		} else if(v == 0x8100) {
			addr = e.top;
			e.top += 2;
			if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
			e.heapdata[addr + 0] = pop_aux();
			e.heapdata[addr + 1] = pop_aux();
			v = 0xe000 | addr;
		} else if(v >= 0xc000) {
			count = v & 0x1fff;
			if(v & 0x2000) {
				v = pop_aux();
			} else {
				v = 0x3f00;
			}
			while(count--) {
				addr = e.top;
				e.top += 2;
				if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
				e.heapdata[addr + 0] = pop_aux();
				e.heapdata[addr + 1] = v;
				v = 0xc000 | addr;
			}
		}
		return v;
	}

	function pop_aux_list() {
		var list = 0x3f00;
		var v;
		while((v = pop_aux())) {
			addr = e.top;
			e.top += 2;
			if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
			e.heapdata[addr + 0] = v;
			e.heapdata[addr + 1] = list;
			list = 0xc000 | addr;
		}
		return list;
	}

	function fieldaddr(field, obj) {
		obj = deref(obj);
		if(obj > e.nob) {
			throw EXPECTOBJ;
		} else {
			return e.ramdata[obj] + field;
		}
	}

	function readfield(field, obj) {
		obj = deref(obj);
		if(obj > e.nob) {
			return 0;
		} else {
			return e.ramdata[e.ramdata[obj] + field];
		}
	}

	function unlink(root_addr, next, key) {
		var tail, addr;

		if(!key || key >= 0x2000) return;
		tail = e.ramdata[fieldaddr(next, key)];
		addr = root_addr;
		while(e.ramdata[addr]) {
			if(e.ramdata[addr] == key) {
				e.ramdata[addr] = tail;
				return;
			}
			addr = fieldaddr(next, e.ramdata[addr]);
		}
	}

	function pop_lts() {
		var v = e.ramdata[--tmp];
		var addr, count;

		if(v == 0x8100) {
			addr = e.top;
			e.top += 2;
			if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
			e.heapdata[addr + 0] = pop_lts();
			e.heapdata[addr + 1] = pop_lts();
			v = 0xe000 | addr;
		} else if(v >= 0xc000) {
			count = v & 0x1fff;
			if(v & 0x2000) {
				v = pop_lts();
			} else {
				v = 0x3f00;
			}
			while(count--) {
				addr = e.top;
				e.top += 2;
				if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
				e.heapdata[addr + 0] = pop_lts();
				e.heapdata[addr + 1] = v;
				v = 0xc000 | addr;
			}
		}
		return v;
	}

	function push_lts(v) {
		var count;

		v = deref(v);
		if(v >= 0xe000) {
			push_lts(e.heapdata[(v & 0x1fff) + 1]);
			push_lts(e.heapdata[(v & 0x1fff) + 0]);
			v = 0x8100;
		} else if(v >= 0xc000) {
			count = 0;
			while(true) {
				push_lts(v - 0x4000);
				count++;
				v = deref(v - 0x3fff);
				if(v == 0x3f00) {
					v = 0xc000 | count;
					break;
				} else if((v & 0xe000) != 0xc000) {
					push_lts(v);
					v = 0xe000 | count;
					break;
				}
			}
		} else if(v >= 0x8000) {
			throw EXPECTBOUND;
		}
		if(tmp > e.ramdata.length) throw LTSFULL;
		e.ramdata[tmp++] = v;
	}

	function clear_lts(addr) {
		var v = e.ramdata[addr];
		var i, size;

		if(v & 0x8000) {
			e.ramdata[addr] = 0;
			v &= 0x7fff;
			size = e.ramdata[v];
			for(i = v; i < e.ltt - size; i++) {
				e.ramdata[i] = e.ramdata[i + size];
			}
			e.ltt -= size;
			while(v < e.ltt) {
				e.ramdata[e.ramdata[v + 1]] -= size;
				v += e.ramdata[v];
			}
		}
	}

	function get_lts(v) {
		if(v & 0x8000) {
			tmp = v & 0x7fff;
			tmp += e.ramdata[tmp];
			return pop_lts();
		} else {
			return v;
		}
	}

	function put_lts(addr, v) {
		clear_lts(addr);
		v = deref(v);
		if(v < 0x8000) {
			e.ramdata[addr] = v;
		} else {
			tmp = e.ltt + 2;
			if(tmp > e.ramdata.length) throw LTSFULL;
			push_lts(v);
			e.ramdata[addr] = 0x8000 | e.ltt;
			e.ramdata[e.ltt + 0] = tmp - e.ltt;
			e.ramdata[e.ltt + 1] = addr;
			e.ltt = tmp;
		}
	}

	function val2str(v) {
		var i, str, entry, len, addr, x, needsp;

		v = deref(v);
		if(v >= 0xe000) {
			str = "";
			for(i = 0; i < 2; i++) {
				x = e.heapdata[(v & 0x1fff) + i];
				if(x >= 0x3f00) {
					while(x >= 0xc000) {
						str += val2str(e.heapdata[x & 0x1fff]);
						x = e.heapdata[(x & 0x1fff) + 1];
					}
				} else {
					str += val2str(x);
				}
			}
		} else if(v >= 0xc000) {
			needsp = false;
			e.upper = false;
			str = "[";
			while((v & 0xe000) == 0xc000) {
				if(needsp) str += " ";
				str += val2str(v - 0x4000);
				needsp = true;
				v = deref(v - 0x3fff);
			}
			if(v == 0x3f00) {
				str += "]";
			} else {
				str += " | " + val2str(v) + "]";
			}
		} else if(v >= 0x8000) {
			e.upper = false;
			str = "$";
		} else if(v >= 0x4000) {
			e.upper = false;
			str = (v & 0x3fff).toString();
		} else if(v >= 0x3f00) {
			e.upper = false;
			str = "[]";
		} else if(v >= 0x3e00) {
			str = decodechar(e, v & 0xff);
		} else if(v >= 0x2000) {
			entry = 2 + (v & 0x1fff) * 3;
			len = e.dict[entry];
			addr = (e.dict[entry + 1] << 8) | e.dict[entry + 2];
			str = "";
			for(i = 0; i < len; i++) {
				str += decodechar(e, e.dict[addr + i]);
			}
		} else if(v) {
			e.upper = false;
			str = "#";
			if(e.tags) {
				addr = get16(e.tags, v * 2);
				while((v = e.tags[addr++])) {
					str += decodechar(e, v);
				}
			}
		}

		return str;
	}

	function wordmap(mapnum, v) {
		var map = get16(e.maps, 2 + mapnum * 2);
		var start = 0;
		var end = get16(e.maps, map);
		var o, mid, midval, ptr;
		while(start < end) {
			mid = (start + end) >> 1;
			midval = get16(e.maps, map + 2 + mid * 4);
			if(midval == v) {
				ptr = get16(e.maps, map + 4 + mid * 4);
				if(!ptr) {
					return false;
				} else if(ptr & 0xe000) {
					if(e.aux >= e.trl) throw AUXFULL;
					e.auxdata[e.aux++] = ptr & 0x1fff;
					return true;
				} else {
					while((o = e.maps[ptr++])) {
						if(e.aux >= e.trl) throw AUXFULL;
						if(o >= 0xe0) {
							o = ((o & 0x1f) << 8) | e.maps[ptr++];
						}
						e.auxdata[e.aux++] = o;
					}
					return true;
				}
			} else if(midval > v) {
				end = mid;
			} else {
				start = mid + 1;
			}
		}
		return true;
	}

	function compat_rand() {
		var high = (e.randomstate >> 16) & 0xffff;
		var low = e.randomstate & 0xffff;
		var newhigh = ((0x15a * low) + (0x4e35 * high)) & 0xffff;
		e.randomstate = (((newhigh << 16)>>>0) + (0x4e35 * low) + 1) & 0xffffffff;
		return (e.randomstate >> 16) & 0x7fff;
	}

	function get_res(id) {
		var obj = {url: "", alt: "", options: ""};
		var n, i, offs;
		if(e.urls) {
			n = get16(e.urls, 0);
			if(id < n) {
				offs = get16(e.urls, 2 + id * 2);
				obj.alt = decodestr(e, (
					(e.urls[offs] << 16) |
					(e.urls[offs + 1] << 8) |
					e.urls[offs + 2]) << e.strshift);
				for(i = 3; e.urls[offs + i]; i++) {
					obj.url += String.fromCharCode(e.urls[offs + i]);
				}
				for(i++; e.urls[offs + i]; i++) {
					obj.options += String.fromCharCode(e.urls[offs + i]);
				}
			}
		}
		return obj;
	}

	function makepairsub(literal, arg, addr) {
		if(literal) {
			e.heapdata[addr] = arg;
		} else if(arg & 0x80) {
			e.heapdata[addr] = destvalue(arg);
		} else {
			e.heapdata[addr] = 0;
			store(arg, 0x8000 | addr);
		}
	}

	function makepair(a1val, a1, a2, a3) {
		var addr;

		if(a3 & 0x80) {
			// unify
			a3 = deref(destvalue(a3));
			if((a3 & 0xe000) == 0xc000) {
				if(a1val) {
					if(!unify(a1, a3 - 0x4000)) fail();
				} else {
					store(a1, a3 - 0x4000);
				}
				store(a2, a3 - 0x3fff);
			} else if((a3 & 0xe000) == 0x8000) {
				addr = e.top;
				e.top += 2;
				if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
				makepairsub(a1val, a1, addr);
				makepairsub(false, a2, addr + 1);
				unify(a3, 0xc000 | addr);
			} else {
				fail();
			}
		} else {
			// create
			addr = e.top;
			e.top += 2;
			if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
			makepairsub(a1val, a1, addr);
			makepairsub(false, a2, addr + 1);
			store(a3, 0xc000 | addr);
		}
	}

	function prepend_chars(v, list) {
		var entry, len, addr, i, ch;

		entry = 2 + (v & 0x1fff) * 3;
		len = e.dict[entry];
		addr = (e.dict[entry + 1] << 8) | e.dict[entry + 2];
		for(i = len - 1; i >= 0; i--) {
			ch = e.dict[addr + i];
			if(ch >= '0' && ch <= '9') {
				ch += 0x4000 - '0';
			} else {
				ch |= 0x3e00;
			}
			list = e.create_pair(ch, list);
		}
		return list;
	}

	function words_to_charlist(list) {
		var buf = [], v, str, ch, entry, len, addr, part1;

		do {
			v = deref(e.heapdata[(list & 0x1fff) + 0]);
			if(v >= 0xe000) {
				part1 = e.heapdata[(v & 0x1fff) + 0];
				if(part1 >= 0x8000) {
					buf = buf.concat(words_to_charlist(part1));
				} else {
					buf = buf.concat(words_to_charlist(v));
				}
			} else if(v >= 0x4000 && v < 0x8000) {
				str = (v & 0x3fff).toString();
				for(i = 0; i < str.length; i++) {
					buf.push(str.charCodeAt(i));
				}
			} else if(v >= 0x3e00 && v < 0x3f00) {
				ch = v & 0xff;
				if(ch <= 0x20) return 0;
				if(e.stopchars.includes(ch)) return 0;
				buf.push(ch);
			} else if(v >= 0x2000 && v < 0x3e00) {
				entry = 2 + (v & 0x1fff) * 3;
				len = e.dict[entry];
				addr = (e.dict[entry + 1] << 8) | e.dict[entry + 2];
				for(i = 0; i < len; i++) {
					buf.push(e.dict[addr + i]);
				}
			} else {
				return 0;
			}
			list = deref(e.heapdata[(list & 0x1fff) + 1]);
		} while((list & 0xe000) == 0xc000);
		if(list != 0x3f00) return 0;
		return buf;
	}

	if(param) {
		store(e.code[e.inst++], param);
	}

	while(true) {
		try {
			while(true) {
				op = e.code[e.inst++];
				//console.log(tohex(e.inst - 1, 6) + ' ' + tohex(op, 2));
				switch(op) {
				case 0x00: // nop
					break;
				case 0x01: // fail
					fail();
					break;
				case 0x02: // set_cont code
					e.cont = fcode();
					break;
				case 0x03: // proceed
					if(e.sim < 0x8000) e.cho = e.sim;
					e.inst = e.cont;
					break;
				case 0x04: // jmp code
					e.inst = fcode();
					break;
				case 0x05: // jmp_multi code
					e.sim = 0xffff;
					e.inst = fcode();
					break;
				case 0x85: // jmpl_multi code
					a1 = fcode();
					e.cont = e.inst;
					e.sim = 0xffff;
					e.inst = a1;
					break;
				case 0x06: // jmp_simple code
					e.sim = e.cho;
					e.inst = fcode();
					break;
				case 0x86: // jmpl_simple code
					a1 = fcode();
					e.cont = e.inst;
					e.sim = e.cho;
					e.inst = a1;
					break;
				case 0x07: // jmp_tail code
					if(e.sim >= 0x8000) e.sim = e.cho;
					e.inst = fcode();
					break;
				case 0x87: // tail
					if(e.sim >= 0x8000) e.sim = e.cho;
					break;
				case 0x08: case 0x88: // push_env byte/0
					a1 = (op & 0x80)? 0 : e.code[e.inst++];
					addr = ((e.env < e.cho) ? e.env : e.cho) - 4 - a1;
					if(addr < e.top) throw HEAPFULL;
					e.heapdata[addr + 0] = e.env;
					e.heapdata[addr + 1] = e.sim;
					e.heapdata[addr + 2] = e.cont >> 16;
					e.heapdata[addr + 3] = e.cont & 0xffff;
					e.env = addr;
					break;
				case 0x09: // pop_env
					e.cont = (e.heapdata[e.env + 2] << 16) | e.heapdata[e.env + 3];
					e.sim = e.heapdata[e.env + 1];
					e.env = e.heapdata[e.env + 0];
					break;
				case 0x89: // pop_env_proceed
					e.inst = (e.heapdata[e.env + 2] << 16) | e.heapdata[e.env + 3];
					if(e.heapdata[e.env + 1] < 0x8000) e.cho = e.heapdata[e.env + 1];
					e.env = e.heapdata[e.env + 0];
					break;
				case 0x0a: case 0x8a: // push_choice byte/0 next
					a1 = (op & 0x80)? 0 : e.code[e.inst++];
					push_cho(a1, fcode());
					break;
				case 0x0b: case 0x8b: // pop_choice byte/0
					a1 = (op & 0x80)? 0 : e.code[e.inst++];
					for(i = 0; i < a1; i++) {
						e.reg[i] = e.heapdata[e.cho + 9 + i];
					}
					while(e.trl < e.heapdata[e.cho + 8]) {
						e.heapdata[e.auxdata[e.trl++]] = 0;
					}
					e.top = e.heapdata[e.cho + 7];
					e.cont = (e.heapdata[e.cho + 2] << 16) | e.heapdata[e.cho + 3];
					e.sim = e.heapdata[e.cho + 1];
					e.env = e.heapdata[e.cho + 0];
					e.cho = e.heapdata[e.cho + 6];
					break;
				case 0x0c: case 0x8c: // pop_push_choice byte/0 code
					a1 = (op & 0x80)? 0 : e.code[e.inst++];
					a2 = fcode();
					e.heapdata[e.cho + 4] = a2 >> 16;
					e.heapdata[e.cho + 5] = a2 & 0xffff;
					for(i = 0; i < a1; i++) {
						e.reg[i] = e.heapdata[e.cho + 9 + i];
					}
					while(e.trl < e.heapdata[e.cho + 8]) {
						e.heapdata[e.auxdata[e.trl++]] = 0;
					}
					e.top = e.heapdata[e.cho + 7];
					e.cont = (e.heapdata[e.cho + 2] << 16) | e.heapdata[e.cho + 3];
					e.sim = e.heapdata[e.cho + 1];
					e.env = e.heapdata[e.cho + 0];
					break;
				case 0x0d: // cut_choice
					e.cho = e.heapdata[e.cho + 6];
					break;
				case 0x0e: // get_cho dest
					store(e.code[e.inst++], e.cho);
					break;
				case 0x0f: // set_cho value
					e.cho = fvalue();
					break;
				case 0x10: case 0x90: // assign value/vbyte dest
					a1 = (op & 0x80)? e.code[e.inst++] : fvalue();
					a2 = e.code[e.inst++];
					store(a2, a1);
					break;
				case 0x11: // make_var dest
					addr = e.top++;
					if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
					e.heapdata[addr] = 0;
					store(e.code[e.inst++], 0x8000 | addr);
					break;
				case 0x12: // make_pair DEST DEST DEST
					a1 = e.code[e.inst++];
					a2 = e.code[e.inst++];
					a3 = e.code[e.inst++];
					makepair(false, a1, a2, a3);
					break;
				case 0x13: case 0x93: // make_pair WORD/VBYTE DEST DEST
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = e.code[e.inst++];
					a3 = e.code[e.inst++];
					makepair(true, a1, a2, a3);
					break;
				case 0x14: // aux_push_val value
					push_aux(fvalue());
					break;
				case 0x94: // aux_push_raw 0
					if(e.aux >= e.trl) throw AUXFULL;
					e.auxdata[e.aux++] = 0;
					break;
				case 0x15: // aux_push_raw word
					if(e.aux >= e.trl) throw AUXFULL;
					e.auxdata[e.aux++] = fword();
					break;
				case 0x95: // aux_push_raw vbyte
					if(e.aux >= e.trl) throw AUXFULL;
					e.auxdata[e.aux++] = e.code[e.inst++];
					break;
				case 0x16: // aux_pop_val dest
					store(e.code[e.inst++], pop_aux());
					break;
				case 0x17: // aux_pop_list dest
					store(e.code[e.inst++], pop_aux_list());
					break;
				case 0x18: // aux_pop_list_chk value
					a1 = deref(fvalue());
					flag = false;
					while((v = e.auxdata[--e.aux])) {
						if(v == a1) flag = true;
					}
					if(!flag) fail();
					break;
				case 0x19: // aux_pop_list_match value
					tmp = e.top;
					a1 = deref(fvalue());
					v = pop_aux_list();
					while((a1 & 0xe000) == 0xc000) {
						iter = v;
						match = false;
						while((iter & 0xe000) == 0xc000 && !match) {
							if(would_unify(iter - 0x4000, a1 - 0x4000)) {
								match = true;
							}
							iter = deref(iter - 0x3fff);
						}
						if(!match) {
							fail();
							break;
						}
						a1 = deref(a1 - 0x3fff);
					}
					e.top = tmp;
					break;
				case 0x1b: // split_list value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					v = 0x3f00;
					if(a1 != a2 && (a1 & 0xe000) == 0xc000) {
						curr = e.top;
						v = 0xc000 | curr;
						while(true) {
							e.top += 2;
							if(e.top > e.env || e.top > e.cho) throw HEAPFULL;
							e.heapdata[curr + 0] = e.heapdata[a1 & 0x1fff];
							a1 = deref(a1 - 0x3fff);
							if(a1 == a2 || (a1 & 0xe000) != 0xc000) {
								break;
							}
							e.heapdata[curr + 1] = 0xc000 | e.top;
							curr = e.top;
						}
						e.heapdata[curr + 1] = 0x3f00;
					}
					store(e.code[e.inst++], v);
					break;
				case 0x1c: // stop
					e.cho = e.stc;
					e.inst = (e.heapdata[e.cho + 4] << 16) | e.heapdata[e.cho + 5];
					break;
				case 0x1d: // push_stop code
					if(e.aux + 2 > e.trl) throw AUXFULL;
					e.auxdata[e.aux++] = e.stc;
					e.auxdata[e.aux++] = e.sta;
					e.sta = e.aux;
					push_cho(0, fcode());
					e.stc = e.cho;
					break;
				case 0x1e: // pop_stop
					e.aux = e.sta;
					e.sta = e.auxdata[--e.aux];
					e.stc = e.auxdata[--e.aux];
					break;
				case 0x1f: // split_word value dest
					a1 = deref(fvalue());
					if(a1 >= 0x2000 && a1 < 0x3e00) {
						v = prepend_chars(a1, 0x3f00);
					} else if(a1 >= 0x3e00 && a1 < 0x3f00) {
						v = e.create_pair(a1, 0x3f00);
					} else if(a1 >= 0x4000 && a1 < 0x8000) {
						i = a1 & 0x3fff;
						v = 0x3f00;
						do {
							v = e.create_pair(0x4000 | (i % 10), v);
							i = Math.floor(i / 10);
						} while(i);
					} else if(a1 >= 0xe000) {
						a2 = e.heapdata[(a1 & 0x1fff) + 0];
						if(a2 >= 0x8000) {
							v = a2;
						} else {
							a3 = e.heapdata[(a1 & 0x1fff) + 1];
							v = prepend_chars(a2, a3);
						}
					} else {
						fail();
						break;
					}
					store(e.code[e.inst++], v);
					break;
				case 0x9f: // join_words value dest
					a1 = deref(fvalue());
					if((a1 & 0xe000) != 0xc000) {
						fail();
						break;
					}
					a2 = deref(e.heapdata[(a1 & 0x1fff) + 0]);
					if((a2 & 0xff00) == 0x3e00) {
						a3 = deref(e.heapdata[(a1 & 0x1fff) + 1]);
						if(a3 == 0x3f00) {
							store(e.code[e.inst++], a2);
							break;
						}
					}
					tmp = words_to_charlist(a1);
					if(tmp) {
						store(e.code[e.inst++], parse_word(tmp, e));
					} else {
						fail();
					}
					break;
				case 0x20: case 0xa0: // load_word value/0 index dest
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					store(e.code[e.inst++], readfield(a2, a1));
					break;
				case 0x21: case 0xa1: // load_byte value/0 index dest
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					v = readfield(a2 >> 1, a1);
					store(e.code[e.inst++], (a2 & 1)? (v & 0xff) : (v >> 8));
					break;
				case 0x22: case 0xa2: // load_val value/0 index dest
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					v = get_lts(readfield(a2, a1));
					if(v) {
						store(e.code[e.inst++], v);
					} else {
						fail();
					}
					break;
				case 0x24: case 0xa4: // store_word value/0 index value
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					e.ramdata[fieldaddr(a2, a1)] = fvalue();
					break;
				case 0x25: case 0xa5: // store_byte value/0 index value
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = fvalue();
					addr = fieldaddr(a2 >> 1, a1);
					if(a2 & 1) {
						e.ramdata[addr] = (e.ramdata[addr] & 0xff00) | (a3 & 0xff);
					} else {
						e.ramdata[addr] = (e.ramdata[addr] & 0x00ff) | ((a3 & 0xff) << 8);
					}
					break;
				case 0x26: case 0xa6: // store_val value/0 index value
					a1 = (op & 0x80)? 0 : deref(fvalue());
					a2 = findex();
					a3 = fvalue();
					if(a1 <= e.nob || a3) {
						put_lts(fieldaddr(a2, a1), a3);
					}
					break;
				case 0x28: case 0xa8: // set_flag value/0 index
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					e.ramdata[fieldaddr(a2 >> 4, a1)] |= 0x8000 >> (a2 & 15);
					break;
				case 0x29: case 0xa9: // reset_flag value/0 index
					a1 = (op & 0x80)? 0 : deref(fvalue());
					a2 = findex();
					if(a1 <= e.nob) {
						e.ramdata[fieldaddr(a2 >> 4, a1)] &= ~(0x8000 >> (a2 & 15));
					}
					break;
				case 0x2d: case 0xad: // unlink value/0 index index value
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = findex();
					unlink(fieldaddr(a2, a1), a3, deref(fvalue()));
					break;
				case 0x2e: case 0x2f: case 0xae: case 0xaf: // set_parent value/vbyte value/vbyte
					a1 = (op & 0x80)? e.code[e.inst++] : deref(fvalue());
					a2 = (op & 0x01)? e.code[e.inst++] : deref(fvalue());
					if(a1 < e.nob || a2) {
						if(a1 >= 0x2000 || a2 >= 0x2000) throw EXPECTOBJ;
						if((v = e.ramdata[fieldaddr(0, a1)])) {
							unlink(fieldaddr(1, v), 2, a1);
						}
						e.ramdata[fieldaddr(0, a1)] = a2;
						if(a2) {
							e.ramdata[fieldaddr(2, a1)] = e.ramdata[fieldaddr(1, a2)];
							e.ramdata[fieldaddr(1, a2)] = a1;
						}
					}
					break;
				case 0x30: case 0xb0: // if_raw_eq word/0 value code
					a1 = (op & 0x80)? 0 : fword();
					a2 = fvalue();
					a3 = fcode();
					if(a1 == a2) {
						e.inst = a3;
					}
					break;
				case 0x31: // if_bound value code
					a1 = deref(fvalue());
					a2 = fcode();
					if((a1 & 0xe000) != 0x8000) {
						e.inst = a2;
					}
					break;
				case 0x32: // if_empty value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 == 0x3f00) {
						e.inst = a2;
					}
					break;
				case 0x33: // if_num value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 >= 0x4000 && a1 < 0x8000) {
						e.inst = a2;
					}
					break;
				case 0x34: // if_pair value code
					a1 = deref(fvalue());
					a2 = fcode();
					if((a1 & 0xe000) == 0xc000) {
						e.inst = a2;
					}
					break;
				case 0x35: // if_obj value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 < 0x2000) {
						e.inst = a2;
					}
					break;
				case 0x36: // if_word value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 >= 0xe000 || (a1 >= 0x2000 && a1 < 0x3f00)) {
						e.inst = a2;
					}
					break;
				case 0xb6: // if_listword value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 >= 0xe000 && ((e.heapdata[a1 & 0x1fff] & 0xe000) == 0xc000)) {
						e.inst = a2;
					}
					break;
				case 0x37: // if_unify value value code
					a1 = fvalue();
					a2 = fvalue();
					a3 = fcode();
					if(would_unify(a1, a2)) {
						e.inst = a3;
					}
					break;
				case 0x38: // if_gt value value code
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					a3 = fcode();
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000 && a1 > a2) {
						e.inst = a3;
					}
					break;
				case 0x39: case 0xb9: // if_eq word/vbyte value code
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = fvalue();
					a3 = fcode();
					if(a1 == deref(a2)) {
						e.inst = a3;
					}
					break;
				case 0x3a: case 0xba: // if_mem_eq value/0 index value code
				case 0x3d: case 0xbd: // if_mem_eq value/0 index vbyte code
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = (op & 1)? e.code[e.inst++] : fvalue();
					a4 = fcode();
					if(readfield(a2, a1) == a3) {
						e.inst = a4;
					}
					break;
				case 0x3b: case 0xbb: // if_flag value/0 index code
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = fcode();
					if(readfield(a2 >> 4, a1) & (0x8000 >> (a2 & 15))) {
						e.inst = a3;
					}
					break;
				case 0x3c: // if_cwl code
					a1 = fcode();
					if(e.cwl) e.inst = a1;
					break;
				case 0x3d: case 0xbd: // if_mem_eq value/0 index vbyte code
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = 
					a4 = fcode();
					if(readfield(a2, a1) == a3) {
						e.inst = a4;
					}
					break;
				case 0x40: case 0xc0: // ifn_raw_eq word/0 value code
					a1 = (op & 0x80)? 0 : fword();
					a2 = fvalue();
					a3 = fcode();
					if(a1 != a2) {
						e.inst = a3;
					}
					break;
				case 0x41: // ifn_bound value code
					a1 = deref(fvalue());
					a2 = fcode();
					if((a1 & 0xe000) == 0x8000) {
						e.inst = a2;
					}
					break;
				case 0x42: // ifn_empty value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 != 0x3f00) {
						e.inst = a2;
					}
					break;
				case 0x43: // ifn_num value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 < 0x4000 || a1 >= 0x8000) {
						e.inst = a2;
					}
					break;
				case 0x44: // ifn_pair value code
					a1 = deref(fvalue());
					a2 = fcode();
					if((a1 & 0xe000) != 0xc000) {
						e.inst = a2;
					}
					break;
				case 0x45: // ifn_obj value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 >= 0x2000) {
						e.inst = a2;
					}
					break;
				case 0x46: // ifn_word value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 < 0xe000 && (a1 < 0x2000 || a1 >= 0x3f00)) {
						e.inst = a2;
					}
					break;
				case 0xc6: // ifn_listword value code
					a1 = deref(fvalue());
					a2 = fcode();
					if(a1 < 0xe000 || ((e.heapdata[a1 & 0x1fff] & 0xe000) != 0xc000)) {
						e.inst = a2;
					}
					break;
				case 0x47: // ifn_unify value value code
					a1 = fvalue();
					a2 = fvalue();
					a3 = fcode();
					if(!would_unify(a1, a2)) {
						e.inst = a3;
					}
					break;
				case 0x48: // ifn_gt value value code
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					a3 = fcode();
					if(!(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000 && a1 > a2)) {
						e.inst = a3;
					}
					break;
				case 0x49: case 0xc9: // ifn_eq word/vbyte value code
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = fvalue();
					a3 = fcode();
					if(a1 != deref(a2)) {
						e.inst = a3;
					}
					break;
				case 0x4a: case 0xca: // ifn_mem_eq value/0 index value code
				case 0x4d: case 0xcd: // ifn_mem_eq value/0 index vbyte code
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = (op & 1)? e.code[e.inst++] : fvalue();
					a4 = fcode();
					if(readfield(a2, a1) != a3) {
						e.inst = a4;
					}
					break;
				case 0x4b: case 0xcb: // ifn_flag value/0 index code
					a1 = (op & 0x80)? 0 : fvalue();
					a2 = findex();
					a3 = fcode();
					if(!(readfield(a2 >> 4, a1) & (0x8000 >> (a2 & 15)))) {
						e.inst = a3;
					}
					break;
				case 0x4c: // ifn_cwl code
					a1 = fcode();
					if(!e.cwl) e.inst = a1;
					break;
				case 0x50: // add_raw value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					store(e.code[e.inst++], (a1 + a2) & 0xffff);
					break;
				case 0xd0: // inc_raw value dest
					a1 = deref(fvalue());
					store(e.code[e.inst++], (a1 + 1) & 0xffff);
					break;
				case 0x51: // sub_raw value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					store(e.code[e.inst++], (a1 - a2) & 0xffff);
					break;
				case 0xd1: // dec_raw value dest
					a1 = deref(fvalue());
					store(e.code[e.inst++], (a1 - 1) & 0xffff);
					break;
				case 0x52: // rand_raw byte dest
					a1 = e.code[e.inst++];
					store(e.code[e.inst++], compat_rand() % (a1 + 1));
					break;
				case 0x58: // add_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000) {
						v = (a1 & 0x3fff) + (a2 & 0x3fff);
						if(v < 0x4000) {
							store(e.code[e.inst++], v | 0x4000);
						} else fail();
					} else fail();
					break;
				case 0xd8: // inc_num value dest
					a1 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x7fff) {
						store(e.code[e.inst++], a1 + 1);
					} else fail();
					break;
				case 0x59: // sub_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000) {
						v = (a1 & 0x3fff) - (a2 & 0x3fff);
						if(v >= 0) {
							store(e.code[e.inst++], v | 0x4000);
						} else fail();
					} else fail();
					break;
				case 0xd9: // dec_num value dest
					a1 = deref(fvalue());
					if(a1 > 0x4000 && a1 < 0x8000) {
						store(e.code[e.inst++], a1 - 1);
					} else fail();
					break;
				case 0x5a: // rand_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000 && a2 >= a1) {
						v = a1 + (compat_rand() % (a2 - a1 + 1));
						store(e.code[e.inst++], v);
					} else fail();
					break;
				case 0x5b: // mul_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000) {
						v = ((a1 & 0x3fff) * (a2 & 0x3fff)) & 0x3fff;
						store(e.code[e.inst++], v | 0x4000);
					} else fail();
					break;
				case 0x5c: // div_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 > 0x4000 && a2 < 0x8000) {
						v = (a1 & 0x3fff) / (a2 & 0x3fff);
						store(e.code[e.inst++], v | 0x4000); // bitwise-or truncates the float
					} else fail();
					break;
				case 0x5d: // mod_num value value dest
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(a1 >= 0x4000 && a1 < 0x8000 && a2 > 0x4000 && a2 < 0x8000) {
						v = (a1 & 0x3fff) % (a2 & 0x3fff);
						store(e.code[e.inst++], v | 0x4000);
					} else fail();
					break;
				case 0x60: // print_a_str_a string
					if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
					io.print(decodestr(e, fstring()));
					e.spc = e.SP_AUTO;
					break;
				case 0xe0: // print_n_str_a string
					if(e.spc == e.SP_PENDING) io.space();
					io.print(decodestr(e, fstring()));
					e.spc = e.SP_AUTO;
					break;
				case 0x61: // print_a_str_n string
					if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
					io.print(decodestr(e, fstring()));
					e.spc = e.SP_NOSPACE;
					break;
				case 0xe1: // print_n_str_n string
					if(e.spc == e.SP_PENDING) io.space();
					io.print(decodestr(e, fstring()));
					e.spc = e.SP_NOSPACE;
					break;
				case 0x62: // nospace
					if(!e.cwl) {
						if(e.spc < e.SP_NOSPACE) {
							e.spc = e.SP_NOSPACE;
						}
					}
					break;
				case 0xe2: // space
					if(!e.cwl) {
						if(e.spc < e.SP_PENDING) {
							e.spc = e.SP_PENDING;
						}
					}
					break;
				case 0x63: // line
					if(!e.cwl) {
						if(e.spc < e.SP_LINE) {
							io.line();
							e.spc = e.SP_LINE;
						}
					}
					break;
				case 0xe3: // par
					if(!e.cwl) {
						if(e.spc < e.SP_PAR) {
							if(e.n_span) {
								io.line();
								io.line();
							} else {
								io.par();
							}
							e.spc = e.SP_PAR;
						}
					}
					break;
				case 0x64: // space_n value
					a1 = deref(fvalue());
					if(!e.cwl && a1 > 0x4000 && a1 < 0x8000) {
						io.space_n(a1 & 0x3fff);
						e.spc = e.SP_SPACE;
					}
					break;
				case 0x65: // print_val value
					a1 = deref(fvalue());
					if(e.cwl) {
						push_aux(a1);
					} else {
						if((a1 & 0xff00) == 0x3e00) {
							tmp = a1 & 0xff;
							if(e.spc == e.SP_PENDING || (e.spc == e.SP_AUTO && !e.nospcbefore.includes(tmp))) {
								io.space();
							}
							io.print(decodechar(e, tmp));
							if(e.nospcafter.includes(tmp)) {
								e.spc = e.SP_NOSPACE;
							} else {
								e.spc = e.SP_AUTO;
							}
						} else {
							if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
							io.print(val2str(a1));
							e.spc = e.SP_AUTO;
						}
					}
					break;
				case 0x66: // enter_div index
					a1 = findex();
					if(!e.cwl) {
						if(e.n_span) throw IOSTATE;
						io.enter_div(a1);
						e.divs.push(a1);
						e.spc = e.SP_PAR;
					}
					break;
				case 0xe6: // leave_div
					if(!e.cwl) {
						io.leave_div(e.divs.pop());
						e.spc = e.SP_PAR;
					}
					break;
				case 0x67: // enter_status 0 index
					a1 = findex();
					if(!e.cwl) {
						if(e.in_status || e.n_span) {
							throw IOSTATE;
						}
						io.enter_status(0, a1);
						e.in_status = a1;
						e.spc = e.SP_PAR;
					}
					break;
				case 0xe7: // leave_status
					if(!e.cwl) {
						io.leave_status();
						e.in_status = null;
						e.spc = e.SP_PAR;
					}
					break;
				case 0x68: // enter_link_res value
					a1 = deref(fvalue());
					if(!e.cwl) {
						if(!e.n_link) {
							if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) {
								io.space();
							}
							io.enter_link_res(get_res(a1 & 0x1fff));
							e.spc = e.SP_NOSPACE;
						}
						e.n_link++;
						e.n_span++;
					}
					break;
				case 0xe8: // leave_link_res
					if(!e.cwl) {
						e.n_link--;
						e.n_span--;
						if(!e.n_link) io.leave_link_res();
					}
					break;
				case 0x69: // enter_link value
					a1 = deref(fvalue());
					if(!e.cwl) {
						if(!e.n_link) {
							if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) {
								io.space();
							}
							i = e.upper;
							e.upper = false;
							str = "";
							while((a1 & 0xe000) == 0xc000) {
								v = deref(a1 - 0x4000);
								if((v >= 0x2000 && v < 0x8000) || v >= 0xe000) {
									if(str) str += " ";
									str += val2str(v);
								}
								a1 = deref(a1 - 0x3fff);
							}
							io.enter_link(str);
							e.upper = i;
							e.spc = e.SP_NOSPACE;
						}
						e.n_link++;
						e.n_span++;
					}
					break;
				case 0xe9: // leave_link
					if(!e.cwl) {
						e.n_link--;
						e.n_span--;
						if(!e.n_link) io.leave_link();
					}
					break;
				case 0x6a: // enter_self_link
					if(!e.cwl) {
						if(!e.n_link) {
							if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) {
								io.space();
							}
							io.enter_self_link(str);
							e.spc = e.SP_NOSPACE;
						}
						e.n_link++;
						e.n_span++;
					}
					break;
				case 0xea: // leave_self_link
					if(!e.cwl) {
						e.n_link--;
						e.n_span--;
						if(!e.n_link) io.leave_self_link();
					}
					break;
				case 0x6b: // set_style byte
					a1 = e.code[e.inst++];
					if(!e.cwl) {
						if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
						io.setstyle(a1);
						e.spc = e.SP_SPACE;
					}
					break;
				case 0xeb: // reset_style byte
					a1 = e.code[e.inst++];
					if(!e.cwl) {
						io.resetstyle(a1);
					}
					break;
				case 0x6c: // embed_res value
					a1 = deref(fvalue());
					if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
					io.embed_res(get_res(a1 & 0x1fff));
					e.spc = e.SP_AUTO;
					break;
				case 0xec: // can_embed_res value dest
					a1 = deref(fvalue());
					store(e.code[e.inst++], io.can_embed_res(get_res(a1 & 0x1fff))? 1 : 0);
					break;
				case 0x6d: // progress value value
					a1 = deref(fvalue());
					a2 = deref(fvalue());
					if(!e.cwl) {
						if(a1 >= 0x4000 && a1 < 0x8000 && a2 >= 0x4000 && a2 < 0x8000) {
							io.progressbar(a1 & 0x3fff, a2 & 0x3fff);
						}
					}
					break;
				case 0x6e: // enter_span index
					a1 = findex();
					if(!e.cwl) {
						if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
						io.enter_span(a1);
						e.n_span++;
						e.spc = e.SP_NOSPACE;
					}
					break;
				case 0xee: // leave_span
					if(!e.cwl) {
						io.leave_span();
						e.n_span--;
						e.spc = e.SP_AUTO;
					}
					break;
				case 0x6f: // enter_status byte index
					a1 = e.code[e.inst++];
					a2 = findex();
					if(!e.cwl) {
						if(e.in_status || e.n_span) {
							throw IOSTATE;
						}
						io.enter_status(a1, a2);
						e.in_status = a2;
						e.spc = e.SP_PAR;
					}
					break;
				case 0x70: // ext0 byte
					a1 = e.code[e.inst++];
					switch(a1) {
					case 0x00: // quit
						io.flush();
						return status.quit;
					case 0x01: // restart
						vm_clear_divs(e);
						vm_reset(e, 0, true);
						vm_restore_state(e, e.initstate);
						io.reset();
						break;
					case 0x02: // restore
						io.flush();
						io.restore();
						return status.restore;
					case 0x03: // undo
						if(e.undodata.length) {
							vm_clear_divs(e);
							vm_restore_state(e, vm_rldec_state(e.initstate, e.undodata.pop()));
						} else if(!e.pruned_undo) {
							fail();
						}
						break;
					case 0x04: // unstyle
						if(!e.cwl) {
							io.unstyle();
						}
						break;
					case 0x05: // print_serial
						if(!e.cwl) {
							if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
							for(i = 0; i < 6; i++) {
								io.print(String.fromCharCode(e.head[6 + i]));
							}
							e.spc = e.SP_AUTO;
						}
						break;
					case 0x06: // clear
					case 0x07: // clear_all
						if(e.in_status || e.n_span) throw IOSTATE;
						tmp = e.divs;
						vm_clear_divs(e);
						if(a1 == 0x06) {
							io.clear();
						} else {
							io.clear_all();
						}
						for(i = 0; i < tmp.length; i++) {
							io.enter_div(tmp[i]);
						}
						e.divs = tmp;
						break;
					case 0x08: // script_on
						if(!io.script_on()) {
							fail();
						}
						break;
					case 0x09: // script_off
						io.script_off();
						break;
					case 0x0a: // trace_on
						e.trace = true;
						break;
					case 0x0b: // trace_off
						e.trace = false;
						break;
					case 0x0c: // inc_cwl
						e.cwl++;
						break;
					case 0x0d: // dec_cwl
						e.cwl--;
						break;
					case 0x0e: // uppercase
						if(!e.cwl) {
							e.upper = true;
						}
						break;
					case 0x0f: // clear_links
						io.clear_links();
						break;
					case 0x10: // clear_old
						if(e.n_span) {
							throw IOSTATE;
						}
						io.clear_old();
						break;
					case 0x11: // clear_div
						io.clear_div();
						break;
					default:
						throw 'Unimplemented ext0 ' + a1.toString(16) + ' at ' + (e.inst - 2).toString(16);
					}
					break;
				case 0x72: // save code
					a1 = fcode();
					if(e.in_status || e.n_span) {
						throw IOSTATE;
					}
					if(!io.save(vm_wrap_savefile(e, vm_rlenc_state(e.initstate, vm_capture_state(e, a1))))) {
						fail();
					}
					break;
				case 0xf2: // save_undo code
					a1 = fcode();
					if(e.in_status || e.n_span) {
						throw IOSTATE;
					}
					if(e.undodata.length > 50) {
						e.undodata = e.undodata.slice(1);
						e.pruned_undo = true;
					}
					e.undodata.push(vm_rlenc_state(e.initstate, vm_capture_state(e, a1)));
					break;
				case 0x73: // get_input dest
					if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
					io.flush();
					return status.get_input;
				case 0xf3: // get_key dest
					if(e.spc == e.SP_AUTO || e.spc == e.SP_PENDING) io.space();
					io.flush();
					return status.get_key;
				case 0x74: // vm_info byte dest
					a1 = e.code[e.inst++];
					v = 0;
					switch(a1) {
					case 0x00: // peak heap
						for(i = 0, v = 0x4000; i < e.heapdata.length; i++) {
							if(e.heapdata[i] != 0x3f3f) v++;
						}
						break;
					case 0x01: // peak aux
						for(i = 0, v = 0x4000; i < e.auxdata.length; i++) {
							if(e.auxdata[i] != 0x3f3f) v++;
						}
						break;
					case 0x02: // peak lts
						for(i = e.ltb, v = 0x4000; i < e.ramdata.length; i++) {
							if(e.ramdata[i] != 0x3f3f) v++;
						}
						break;
					case 0x40: // interpreter supports undo
						v = 1;
						break;
					case 0x41: // interpreter supports save/restore
						v = 1;
						break;
					case 0x42: // interpreter supports links
						v = io.have_links()? 1 : 0;
						break;
					case 0x43: // interpreter supports quit
						v = e.havequit? 1 : 0;
						break;
					case 0x60: // interpreter supports top status area
						v = e.havetop? 1 : 0;
						break;
					case 0x61: // interpreter supports inline status area
						v = e.haveinline? 1 : 0;
						break;
					default:
						if(a1 < 0x40) {
							throw 'Unimplemented vminfo ' + a1.toString(16) + ' at ' + (e.inst - 2).toString(16);
						}
					}
					store(e.code[e.inst++], v);
					break;
				case 0x78: // set_idx value
					v = deref(fvalue());
					if(v >= 0xe000) v = e.heapdata[v & 0x1fff];
					e.reg[0x3f] = v;
					break;
				case 0x79: case 0xf9: // check_eq word/vbyte code
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = fcode();
					if(e.reg[0x3f] == a1) e.inst = a2;
					break;
				case 0x7a: case 0xfa: // check_gt_eq word/vbyte code code
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = fcode();
					a3 = fcode();
					if(e.reg[0x3f] > a1) {
						e.inst = a2;
					} else if(e.reg[0x3f] == a1) {
						e.inst = a3;
					}
					break;
				case 0x7b: case 0xfb: // check_gt value/byte code
					a1 = (op & 0x80)? e.code[e.inst++] : fvalue();
					a2 = fcode();
					if(e.reg[0x3f] > a1) {
						e.inst = a2;
					}
					break;
				case 0x7c: // check_wordmap index code
					a1 = findex();
					a2 = fcode();
					if(wordmap(a1, e.reg[0x3f])) {
						e.inst = a2;
					}
					break;
				case 0x7d: case 0xfd: // check_eq word/vbyte word/vbyte code
					a1 = (op & 0x80)? e.code[e.inst++] : fword();
					a2 = (op & 0x80)? e.code[e.inst++] : fword();
					a3 = fcode();
					if(e.reg[0x3f] == a1 || e.reg[0x3f] == a2) e.inst = a3;
					break;
				case 0x7f: // tracepoint string string string word
					a1 = fstring();
					a2 = fstring();
					a3 = fstring();
					a4 = fword();
					if(e.trace) {
						str = decodestr(e, a1) + "(";
						a2 = decodestr(e, a2);
						j = 0;
						for(i = 0; i < a2.length; i++) {
							if(a2[i] == '$') {
								str += val2str(e.reg[j++]);
							} else {
								str += a2[i];
							}
						}
						str += ") " + decodestr(e, a3) + ":" + a4;
						io.trace(str);
					}
					break;
				default:
					throw 'Unimplemented op ' + op.toString(16) + ' at ' + (e.inst - 1).toString(16);
				}
			}
		} catch(x) {
			if(x > 0x4000 && x < 0x8000) {
				if(e.spc < e.SP_LINE) {
					io.line();
				}
				vm_clear_divs(e);
				vm_reset(e, x, false);
			} else {
				throw x;
			}
		}
	}
}

function parse_word(chars, e) {
	var state = 0;
	var rev_ending = [];
	var v, i, instr, next;
	var len = chars.length;
	var enddecoder = get16(e.lang, 4);

	function buildlist(list) {
		var i, v = 0x3f00, ch;

		for(i = 0; i < list.length; i++) {
			ch = list[i];
			if(ch >= 0x30 && ch <= 0x39) {
				v = e.create_pair(ch + 0x4000 - 0x30, v);
			} else {
				v = e.create_pair(0x3e00 | ch, v);
			}
		}
		return v;
	}

	function finddict() {
		var start = 0;
		var end = get16(e.dict, 0);
		var diff, i, mid, dictlen, dictoffs;

		while(start < end) {
			mid = (start + end) >> 1;
			dictlen = e.dict[2 + 3 * mid];
			dictoffs = get16(e.dict, 2 + 3 * mid + 1);
			for(i = 0; i < len && i < dictlen; i++) {
				diff = chars[i] - e.dict[dictoffs + i];
				if(diff) break;
			}
			if(i == dictlen && i == len) {
				if(!diff) {
					return 0x2000 | mid;
				}
			} else if(i == dictlen) {
				diff = 1;
			} else if(i == len) {
				diff = -1;
			}
			if(diff < 0) {
				end = mid;
			} else {
				start = mid + 1;
			}
		}
		return 0;
	}

	if(len > 1 && (v = finddict())) {
		return v;
	}

	v = 0;
	for(i = 0; i < chars.length; i++) {
		if(chars[i] < 0x30 || chars[i] > 0x39) break;
		v = v * 10 + chars[i] - 0x30;
		if(v >= 16384) break;
	}
	if(i == chars.length) {
		return 0x4000 | v;
	}

	if(len == 1) {
		return 0x3e00 | chars[0];
	}

	while(true) {
		instr = e.lang[enddecoder + state++];
		if(!instr) {
			while(len) rev_ending.push(chars[--len]);
			return e.create_pair(buildlist(rev_ending), 0x3f00) | 0xe000;
		} else if(instr == 1) {
			if((v = finddict())) {
				return e.create_pair(v, buildlist(rev_ending)) | 0xe000;
			}
		} else {
			next = e.lang[enddecoder + state++];
			if(len > 2 && instr == chars[len - 1]) {
				rev_ending.push(instr);
				len--;
				state = next;
			}
		}
	}
}

function vm_proceed_with_input(e, str) {
	var words = [];
	var i, j, start, v, uchar, entry;
	var chars = new Uint8Array(str.length);

	for(i = 0; i < str.length; i++) {
		uchar = str.charCodeAt(i);
		if(uchar >= 0x41 && uchar <= 0x5a) {
			chars[i] = uchar ^ 0x20;
		} else if(uchar < 0x80) {
			chars[i] = uchar;
		} else {
			chars[i] = 0x3f;
			for(j = e.lang[e.extchars] - 1; j >= 0; j--) {
				entry = e.extchars + 1 + j * 5;
				if(e.lang[entry + 2] == ((uchar >> 16) & 0xff) &&
				e.lang[entry + 3] == ((uchar >> 8) & 0xff) &&
				e.lang[entry + 4] == (uchar & 0xff)) {
					chars[i] = e.lang[entry];
					break;
				}
			}
		}
	}

	start = 0;
	for(i = 0; i < str.length; i++) {
		if(chars[i] == 32) {
			if(i != start) words.push(chars.slice(start, i));
			start = i + 1;
		} else {
			if(e.stopchars.includes(chars[i])) {
				if(i != start) words.push(chars.slice(start, i));
				words.push(chars.slice(i, i + 1));
				start = i + 1;
			}
		}
	}
	if(i != start) words.push(chars.slice(start, i));

	v = 0x3f00;
	try {
		for(i = words.length - 1; i >= 0; i--) {
			v = e.create_pair(parse_word(words[i], e), v);
		}
	} catch(x) {
		if(x == HEAPFULL) {
			if(e.spc < e.SP_LINE) {
				e.io.line();
			}
			vm_clear_divs(e);
			vm_reset(e, x, false);
			v = null;
		} else {
			throw x;
		}
	}

	e.spc = e.SP_LINE;
	return vm_run(e, v);
}

function vm_proceed_with_key(e, code) {
	var v, i, entry;
	if(code >= 0x20 && code < 0x7f) {
		if(code >= 0x41 && code <= 0x5a) code ^= 0x20;
		v = code;
	}
	if(!v) {
		for(i in keys) {
			if(keys.hasOwnProperty(i) && code == keys[i]) {
				v = code;
				break;
			}
		}
	}
	if(!v) {
		for(i = 0; i < e.lang[e.extchars]; i++) {
			entry = 1 + i * 5;
			if(code == (e.lang[entry + 2] << 16) |
				(e.lang[entry + 3] << 8) |
				e.lang[entry + 4])
			{
				break;
			}
		}
		if(i < e.lang[e.extchars]) {
			v = 0x80 | e.lang[1 + i * 5];
		}
	}
	if(!v) {
		return status.get_key;
	} else {
		e.spc = e.SP_SPACE;
		if(v >= 0x30 && v <= 0x39) {
			v += 0x4000 - 0x30;
		} else {
			v |= 0x3e00;
		}
		return vm_run(e, v);
	}
}

var instance_e;

var aaengine = {
	prepare_story: function(file_array, io, seed, quit, toparea, inlinearea) {
		instance_e = prepare_story(file_array, io, seed, quit, toparea, inlinearea);
		this.keys = keys;
		this.status = status;
	},
	get_styles: function() {
		return get_styles(instance_e);
	},
	get_metadata: function() {
		return get_metadata(instance_e);
	},
	get_file: function(name) {
		return instance_e.files[name];
	},
	get_story_key: function() {
		var i, str, hex;
		str = this.get_metadata().title.replace(/[^a-zA-Z0-9]+/g, "-") + "-";
		for(i = 0; i < 6; i++) str += decodechar(instance_e, instance_e.head[6 + i]);
		str += "-";
		for(i = 0; i < 4; i++) {
			hex = instance_e.head[12 + i].toString(16);
			if(hex.length == 1) hex = "0" + hex;
			str += hex;
		}
		return str;
	},
	vm_start: function() {
		return vm_run(instance_e, null);
	},
	vm_proceed_with_input: function(str) {
		return vm_proceed_with_input(instance_e, str);
	},
	vm_proceed_with_key: function(charcode) {
		return vm_proceed_with_key(instance_e, charcode);
	},
	vm_restore: function(filedata) {
		var v;
		if(filedata && (v = vm_unwrap_savefile(instance_e, filedata))) {
			vm_clear_divs(instance_e);
			vm_reset(instance_e, 0, true);
			vm_restore_state(instance_e, vm_rldec_state(instance_e.initstate, v));
		}
		instance_e.spc = instance_e.SP_LINE;
		return vm_run(instance_e, null);
	},
	async_restart: function() {
		vm_clear_divs(instance_e);
		vm_reset(instance_e, 0, true);
		vm_restore_state(instance_e, instance_e.initstate);
		instance_e.io.reset();
		return vm_run(instance_e, null);
	},
	async_save: function(st) {
		var state = vm_capture_state(instance_e, instance_e.inst - ((st == status.quit)? 2 : 1));
		return vm_wrap_savefile(instance_e, vm_rlenc_state(instance_e.initstate, state));
	},
	async_restore: function(filedata) {
		var v;
		v = vm_unwrap_savefile(instance_e, filedata);
		vm_reset(instance_e, 0, true);
		vm_restore_state(instance_e, vm_rldec_state(instance_e.initstate, v));
		instance_e.spc = instance_e.SP_LINE;
	},
	async_resume: function() {
		return vm_run(instance_e, null);
	},
	get_undo_array: function() {
		return instance_e.undodata.map(function(state) {return vm_wrap_savefile(instance_e, state)});
	},
	set_undo_array: function(arr) {
		instance_e.undodata = arr.map(function(wrapped) {return vm_unwrap_savefile(instance_e, wrapped)});
	},
	mem_info: function() {
		var h = 0, a = 0, lts = 0, i;
		var e = instance_e;
		for(i = 0; i < e.heapdata.length; i++) {
			if(e.heapdata[i] != 0x3f3f) h++;
		}
		for(i = 0; i < e.auxdata.length; i++) {
			if(e.auxdata[i] != 0x3f3f) a++;
		}
		for(i = e.ltb; i < e.ramdata.length; i++) {
			if(e.ramdata[i] != 0x3f3f) lts++;
		}
		return {
			heap: h,
			aux: a,
			lts: lts,
			heapsize: e.heapdata.length,
			auxsize: e.auxdata.length,
			ltssize: e.ramdata.length - e.ltb};
	},
};

if(typeof module === 'undefined') {
	window.aaengine = aaengine;
} else {
	module.exports = aaengine;
}

})();
