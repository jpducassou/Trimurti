/**
 *	this is a port of pyflate
 *	@url http://www.paul.sladen.org/projects/pyflate/
 *	@author kirilloid
 * @license CC-SA 3.0
 * @usage ArchUtils.bz2.decode(str)
 * @example ArchUtils.bz2.decode(
 * 		"BZh91AY&SYN\xEC\xE86\0\0\2Q\x80\0\x10@\0\6D\x90\x80 " +
 * 		"\x001\6LA\1\xA7\xA9\xA5\x80\xBB\x941\xF8\xBB\x92)\xC2\x84\x82wgA\xB0"
 * ) == "hello world\n";
 */

var BZip2 = (function() {
	/**
	 * bwt_reverse code from wikipedia (slightly modified)
	 * @url http://en.wikipedia.org/wiki/Burrows%E2%80%93Wheeler_transform
	 * @license: CC-SA 3.0
	 */

	function bwt_reverse(src, primary) {
		var len = src.length, A = src,
			i, start = {}, links = [],
			ii = primary, first, ret = '',
			j;
		if (primary >= len) throw Error;//throw RangeError("Out of bound");
		if (primary < 0) throw Error;//throw RangeError("Out of bound");

		//only used on arrays, optimized, Gonzalo
		src = src.join('');
		A.sort();
		
		for (i = len - 1; i >= 0; start[A[i]] = i-- );
		
		for (i = 0; i < len; links.push(start[src[i++]]++));
		
		first = A[ii];
		
		for (j = 1; j < len; j++) ret=(A[ii = links[ii]]) + ret;
		
		return first + ret;
	}

	//move_to_front is always used to store result in array, optimized, Gonzalo
	function move_to_front_and_store(a, c, buff) {
		var v = a[c];
		
		a.splice(c,1); //remove element at c
		a.splice(0,0,v); //add v at the beginning
		
		buff.push(v);
	}
	
	//mask long function name for YUI optimization
	function charCodeAt(what, at) {
		return what.charCodeAt(at) & 255;
	}
	
	function readbits( what, how_much) {
		return what.readbits(how_much);
	}
	
	/**
	 * @class RBitfield
	 * right-sided bitfield for reading bits in byte from right to left
	 */
	var RBitfield;
	(function () {
		RBitfield = function(x) {
			this.f = x;
			this.bits = this.bitfield = this.count = 0;
		};
		RBitfield.prototype = {
			readbits:function(n) {
				var m, r;
				
				while (this.bits < n) {
					this.bitfield = (this.bitfield << 8) + charCodeAt(this.f, this.count++);
					this.bits += 8;
				}
				
				m = (1 << n) - 1;
				this.bits -= n;
				r = (this.bitfield >> this.bits) & m;
				this.bitfield &= ~ (m << this.bits);
				return r;
			}
		};
	})();
	
	/**
	 * @class HuffmanLength
	 * utility class, used for comparison of huffman codes
	 */
	var HuffmanLength = function(code, bits) {
		this.code = code;
		this.bits = bits;
	};
	
	/**
	 * @class OrderedHuffmanTable
	 * utility class for working with huffman table
	 */
	var OrderedHuffmanTable = function(lengths) {
		var me = this;
		var len = lengths.length, z = [], i;
		
		for (i = 0; i < len; i++) z.push([i, lengths[i]]);
		z.push([len, -1]);

		var table = [], b = z[0], start = b[0], bits = b[1];
		
		for (var p = 1; p < z.length; p++) {
			var code, finish = z[p][0], endbits = z[p][1];
			
			if (bits) for (code = start; code < finish; code++) table.push(new HuffmanLength(code, bits));
			
			start = finish;
			bits = endbits;
			
			if (endbits == -1) break;
		}
		
		table.sort(function(a, b) { return (a.bits - b.bits) || (a.code - b.code); });
		
		//inlined populate_huffman_symbols, Gonzalo
		var temp_bits = 0, symbol = -1, cb = null;
		
		// faht = Fast Access Huffman Table
		this.faht = [];
		
		console.log( table );
		
		table.forEach( function(x) {
			symbol++;
			if (x.bits != temp_bits) {
				symbol <<= x.bits - temp_bits;
				cb = me.faht[temp_bits = x.bits] = {};
			}
			cb[symbol] = x;
		}, me);
	};

	return ({
		decode: function(input) {
			//.magic:16                       = 'BZ' signature/magic number
			//.version:8                      = 'h' for Bzip2 ('H'uffman coding), '0' for Bzip1 (deprecated)
			//.hundred_k_blocksize:8          = '1'..'9' block-size 100 kB-900 kB
			//
			//.compressed_magic:48            = 0x314159265359 (BCD (pi))
			//.crc:32                         = checksum for this block
			//.randomised:1                   = 0=>normal, 1=>randomised (deprecated)
			//.origPtr:24                     = starting pointer into BWT for after untransform
			//.huffman_used_map:16            = bitmap, of ranges of 16 bytes, present/not present
			//.huffman_used_bitmaps:0..256    = bitmap, of symbols used, present/not present (multiples of 16)
			//.huffman_groups:3               = 2..6 number of different Huffman tables in use
			//.selectors_used:15              = number of times that the Huffman tables are swapped (each 50 bytes)
			//*.selector_list:1..6            = zero-terminated bit runs (0..62) of MTF'ed Huffman table (*selectors_used)
			//.start_huffman_length:5         = 0..20 starting bit length for Huffman deltas
			//*.delta_bit_length:1..40        = 0=>next symbol; 1=>alter length
			//																								{ 1=>decrement length;  0=>increment length } (*(symbols+2)*groups)
			//.contents:2..infinity           = Huffman encoded data stream until end of block
			//
			//.eos_magic:48                   = 0x177245385090 (BCD sqrt(pi))
			//.crc:32                         = checksum for whole stream
			//.padding:0..7                   = align to whole byte
			var input_as_bits = new RBitfield(input);
			//check .magic == 'BZ' and .version = 'h'
			if ( readbits(input_as_bits, 24) != 0x425A68 ) throw Error; //Bzip 1.05 magic is BZh (BZ\0 is an error)

			//get .hundred_k_blocksize from ASCII->1..9 range or error
			var blocksize = readbits(input_as_bits,8) - 48;
			if (blocksize < 1 || blocksize > 9) throw Error;//throw "Unknown (not size '1'-'9') Bzip2 blocksize";

			var out = '';

			do {
				//avoid bitwise ops on ops longer than int32
				var blocktype = [readbits(input_as_bits,24),readbits(input_as_bits,24)];
				var crc = [readbits(input_as_bits,16),readbits(input_as_bits,16)];
				if (blocktype[0] == 0x314159 && blocktype[1] == 0x265359) { // (pi)
					if (readbits(input_as_bits,1)) throw Error;//throw "Bzip2 randomised support not implemented";
					var pointer = readbits(input_as_bits,24);
					
					//inlined: getUsedCharGroups
					var inUse256 = [], m1, m2;
					var used_groups = readbits(input_as_bits, 16);
					for (m1 = 1 << 15; m1 > 0; m1 >>= 1) {
						if ( used_groups & m1 ) {
							var used_chars = readbits(input_as_bits, 16);
							for (m2 = 1 << 15; m2 > 0; m2 >>= 1) inUse256.push( Boolean(used_chars & m2) );
						} else {
							for (m2 = 0; m2 < 16; m2++) inUse256.push( 1<1 ); //false!
						}
					}

					var huffman_groups = readbits(input_as_bits,3);
					if (2 > huffman_groups || huffman_groups > 6) throw Error;//throw RangeError("Bzip2: Number of Huffman groups not in range 2..6");
					var mtf = [0, 1, 2, 3, 4, 5, 6].slice(0, huffman_groups); //eliminate use of range, Gonzalo
					var selectors_list = [];
					for (var i = 0, selectors_used = readbits(input_as_bits,15); i < selectors_used; i++) {
						// zero-terminated bit runs (0..62) of MTF'ed huffman table 
						var c = 0;
						while (readbits(input_as_bits,1)) {
							if (c++ >= huffman_groups) throw Error;//throw RangeError("More than max (" + huffman_groups + ") groups");
						}
						move_to_front_and_store(mtf, c, selectors_list); //optimized to single function, Gonzalo
					}
					var groups_lengths = [];

					// INLINE: sum used only once, Gonzalo
					var symbols_in_use = inUse256.reduce(function(a, b) { return a + b }, 0) + 2; //sum(inUse256) + 2 // remember RUN[AB] RLE symbols

					for (var j = 0; j < huffman_groups; j++) {
						var length = readbits(input_as_bits,5);
						var lengths = [];
						for (var i = 0; i < symbols_in_use; i++) {
							if (length < 0 || length > 20) throw Error;//throw RangeError("Bzip2 Huffman length code outside range 0..20");
							while (readbits(input_as_bits,1)) length -= (readbits(input_as_bits,1) * 2) - 1;
							lengths.push(length);
						}
						groups_lengths.push(lengths);
					}
					
					var tables = [];
					for (var g = 0; g < groups_lengths.length; g++) {
						var codes = new OrderedHuffmanTable(groups_lengths[g]);
						tables.push(codes);
					}
					
					var favourites = [];
					for (var c = inUse256.length - 1; c >= 0; c--) {
						if (inUse256[c]) favourites.push(String.fromCharCode(c)); //inlined chr, used once, Gonzalo
					}
					favourites.reverse();
					
					var selector_pointer = 0, decoded = 0, t;

					// Main Huffman loop
					var repeat = 0, repeat_power = 0, buffer = [], r;

					do {
						if (--decoded <= 0) {
							decoded = 50;
							if (selector_pointer <= selectors_list.length) t = tables[selectors_list[selector_pointer++]];
						}

						// INLINED: find_next_symbol
						for (var bb in t.faht) {
							if (input_as_bits.bits < bb) {
								input_as_bits.bitfield = (input_as_bits.bitfield << 8) + charCodeAt(input_as_bits.f,input_as_bits.count++);
								input_as_bits.bits += 8;
							}
							if (r = t.faht[bb][input_as_bits.bitfield >> (input_as_bits.bits - bb)]) {
								input_as_bits.bitfield &= (1 << (input_as_bits.bits -= bb)) - 1;
								r = r.code;
								break;
							}
						}

						if (0 <= r && r <= 1) {
							if (repeat == 0) repeat_power = 1;
							repeat += repeat_power << r;
							repeat_power <<= 1;
						} else {
							for (; repeat > 0; repeat--) buffer.push(favourites[0]);
							
							if (r != symbols_in_use - 1) { // eof symbol
								move_to_front_and_store(favourites, r - 1, buffer); //Uninlined, size efficiency, Gonzalo
							}
						}
					} while ( r != symbols_in_use - 1)
					
					var nt = bwt_reverse(buffer, pointer);
					
					var rle = '';
					var i = 0, c;
					// RLE decoding
					while (i < nt.length) {
						rle += (c = nt[i] ); //always have a character like this one
						if ((i < nt.length - 4) && nt.substr(i+1,3) == c+c+c ) {
							//we have 3 more, so we have a repeat code
							i += 4;
							//join only adds separator n - 1 times, then + 3 because we have one already pushed
							for ( var rep = charCodeAt(nt, i) + 3; rep > 0; rep-- ) rle += c;
						}
						i++;
					}
					out+=rle;
				} else if (blocktype[0] == 0x177245 && blocktype[1] == 0x385090) { // sqrt(pi)
					readbits(input_as_bits,input_as_bits.bits & 0x7); //align
				} else {
					throw Error;//throw "Illegal Bzip2 blocktype = 0x" + blocktype.toString(16);
				}
			} while ( input_as_bits.count < input_as_bits.f.length );
			return out;
		}
	}
	);
})();