// node_modules/@noble/hashes/_u64.js
const fromNumH = (n) => n / 2 ** 32 | 0;
const fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
	const h = fromNumH(n);
	const l = fromNumL(n);
	view.setUint32(byteOffset, isLE ? l : h, isLE);
	view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
// node_modules/@noble/hashes/utils.js
/**
* Checks if something is Uint8Array. Be careful: nodejs Buffer will return true.
* @param a - value to test
* @returns `true` when the value is a Uint8Array-compatible view.
* @example
* Check whether a value is a Uint8Array-compatible view.
* ```ts
* isBytes(new Uint8Array([1, 2, 3]));
* ```
*/
function isBytes(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle = (title) => title ? `"${title}" ` : "";
/**
* Asserts something is a non-negative integer.
* @param n - number to validate
* @param title - label included in thrown errors
* @returns The validated number.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a non-negative integer option.
* ```ts
* anumber(32, 'length');
* ```
*/
function anumber(n, title = "") {
	if (typeof n !== "number") throw new TypeError(atitle(title) + "expected number, got " + typeof n);
	if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
	return n;
}
/**
* Asserts something is Uint8Array.
* @param value - value to validate
* @param length - optional exact length constraint
* @param title - label included in thrown errors
* @returns The validated byte array.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate that a value is a byte array.
* ```ts
* abytes(new Uint8Array([1, 2, 3]));
* ```
*/
function abytes(value, length, title = "") {
	if (isBytes(value) && (length === void 0 || value.length === length)) return value;
	if (length !== void 0) anumber(length, "length");
	const bytes = isBytes(value);
	const ofLen = length !== void 0 ? ` of length ${length}` : "";
	const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
	const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
	if (!bytes) throw new TypeError(message);
	throw new RangeError(message);
}
const aobject = (value, label) => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
const aopts = (value, label) => {
	aobject(value, label);
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) throw new TypeError(`"${label}" expected plain object`);
	if (Object.hasOwn(value, "__proto__")) throw new TypeError(`"${label}.__proto__" is not allowed`);
};
/**
* Asserts a hash instance has not been destroyed or finished.
* @param instance - hash instance to validate
* @param checkFinished - whether to reject finalized instances
* @throws If the hash instance has already been destroyed or finalized. {@link Error}
* @example
* Validate that a hash instance is still usable.
* ```ts
* import { aexists } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aexists(hash);
* ```
*/
function aexists(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("hash was destroyed");
	if (checkFinished && instance.finished) throw new Error("digest() was already called");
}
/**
* Asserts output is a sufficiently-sized byte array.
* @param out - destination buffer
* @param instance - hash instance providing output length
* Oversized buffers are allowed; downstream code only promises to fill the first `outputLen` bytes.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a caller-provided digest buffer.
* ```ts
* import { aoutput } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aoutput(new Uint8Array(hash.outputLen), hash);
* ```
*/
function aoutput(out, instance) {
	abytes(out, void 0, "output");
	const min = instance.outputLen;
	if (!(out.length >= min)) throw new RangeError("\"output\" expected length >= " + min);
}
/**
* Zeroizes typed arrays in place. Warning: JS provides no guarantees.
* @param arrays - arrays to overwrite with zeros
* @example
* Zeroize sensitive buffers in place.
* ```ts
* clean(new Uint8Array([1, 2, 3]));
* ```
*/
function clean(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/**
* Creates a DataView for byte-level manipulation.
* @param arr - source typed array
* @returns DataView over the same buffer region.
* @example
* Create a DataView over an existing buffer.
* ```ts
* createView(new Uint8Array(4));
* ```
*/
function createView(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/**
* Rotate-right operation for uint32 values.
* @param word - source word
* @param shift - shift amount in bits
* @returns Rotated word.
* @example
* Rotate a 32-bit word to the right.
* ```ts
* rotr(0x12345678, 8);
* ```
*/
function rotr(word, shift) {
	return word << 32 - shift | word >>> shift;
}
/**
* Merges default options and passed options.
* @param defaults - base option object
* @param opts - user overrides
* @param title - label included in thrown override errors
* @returns Fresh merged option object with a null prototype.
* @throws On wrong argument types. {@link TypeError}
* @example
* Merge user overrides onto default options.
* ```ts
* checkOpts({ dkLen: 32 }, { asyncTick: 10 });
* ```
*/
function checkOpts(defaults, opts, title = "opts") {
	aopts(defaults, "defaults");
	if (opts !== void 0) aopts(opts, title);
	return Object.assign(Object.create(null), defaults, opts);
}
/**
* Creates a callable hash function from a stateful class constructor.
* @param hashCons - hash constructor or factory
* @param info - optional metadata such as DER OID
* @returns Frozen callable hash wrapper with `.create()`.
*   Wrapper construction eagerly calls `hashCons(undefined)` once to read
*   `outputLen` / `blockLen`, so constructor side effects happen at module
*   init time.
* @throws On wrong argument types. {@link TypeError}
* @example
* Wrap a stateful hash constructor into a callable helper.
* ```ts
* import { createHasher } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const wrapped = createHasher(sha256.create, { oid: sha256.oid });
* wrapped(new Uint8Array([1]));
* ```
*/
function createHasher(hashCons, info = {}) {
	if (typeof hashCons !== "function") throw new TypeError("\"hashCons\" expected function, got type=" + typeof hashCons);
	info = checkOpts({}, info, "info");
	const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
	const tmp = hashCons(void 0);
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.canXOF = tmp.canXOF;
	hashC.create = (opts) => hashCons(opts);
	Object.assign(hashC, info);
	return Object.freeze(hashC);
}
/**
* Creates OID metadata for NIST hashes with prefix `06 09 60 86 48 01 65 03 04 02`.
* @param suffix - final OID byte for the selected hash.
*   The helper accepts any byte even though only the documented NIST hash
*   suffixes are meaningful downstream.
* @returns Object containing the DER-encoded OID.
* @example
* Build OID metadata for a NIST hash.
* ```ts
* oidNist(0x01);
* ```
*/
const oidNist = (suffix) => ({ oid: Uint8Array.from([
	6,
	9,
	96,
	134,
	72,
	1,
	101,
	3,
	4,
	2,
	suffix
]) });
// node_modules/@noble/hashes/_md.js
/**
* Internal Merkle-Damgard hash utils.
* @module
*/
/**
* Shared 32-bit conditional boolean primitive reused by SHA-256, SHA-1, and MD5 `F`.
* Returns bits from `b` when `a` is set, otherwise from `c`.
* The XOR form is equivalent to MD5's `F(X,Y,Z) = XY v not(X)Z` because the masked terms never
* set the same bit.
* @param a - selector word
* @param b - word chosen when selector bit is set
* @param c - word chosen when selector bit is clear
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit choice primitive.
* ```ts
* Chi(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Chi(a, b, c) {
	return a & b ^ ~a & c;
}
/**
* Shared 32-bit majority primitive reused by SHA-256 and SHA-1.
* Returns bits shared by at least two inputs.
* @param a - first input word
* @param b - second input word
* @param c - third input word
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit majority primitive.
* ```ts
* Maj(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Maj(a, b, c) {
	return a & b ^ a & c ^ b & c;
}
/**
* Merkle-Damgard hash construction base class.
* Could be used to create MD5, RIPEMD, SHA1, SHA2.
* Accepts only byte-aligned `Uint8Array` input, even when the underlying spec describes bit
* strings with partial-byte tails.
* @param blockLen - internal block size in bytes
* @param outputLen - digest size in bytes
* @param padOffset - trailing length field size in bytes
* @param isLE - whether length and state words are encoded in little-endian
* @example
* Use a concrete subclass to get the shared Merkle-Damgard update/digest flow.
* ```ts
* import { _SHA1 } from '@noble/hashes/legacy.js';
* const hash = new _SHA1();
* hash.update(new Uint8Array([97, 98, 99]));
* hash.digest();
* ```
*/
var HashMD = class {
	blockLen;
	outputLen;
	canXOF = false;
	padOffset;
	isLE;
	buffer;
	view;
	finished = false;
	length = 0;
	pos = 0;
	destroyed = false;
	constructor(blockLen, outputLen, padOffset, isLE) {
		this.blockLen = blockLen;
		this.outputLen = outputLen;
		this.padOffset = padOffset;
		this.isLE = isLE;
		this.buffer = new Uint8Array(blockLen);
		this.view = createView(this.buffer);
	}
	update(data) {
		aexists(this);
		abytes(data);
		const { view, buffer, blockLen } = this;
		const len = data.length;
		let processed = false;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				const dataView = createView(data);
				for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
				processed = true;
				continue;
			}
			buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(view, 0);
				this.pos = 0;
				processed = true;
			}
		}
		this.length += data.length;
		if (processed) this.roundClean();
		return this;
	}
	digestInto(out) {
		aexists(this);
		aoutput(out, this);
		this.finished = true;
		const { buffer, view, blockLen, isLE } = this;
		let { pos } = this;
		buffer[pos++] = 128;
		buffer.fill(0, pos);
		if (this.padOffset > blockLen - pos) {
			this.process(view, 0);
			buffer.fill(0);
		}
		setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
		this.process(view, 0);
		this.roundClean();
		const oview = out === buffer ? view : createView(out);
		const len = this.outputLen;
		const outLen = len / 4;
		const state = this.get();
		if (len % 4 || outLen > state.length) throw new Error("invalid outputLen");
		for (let i = 0; i < outLen; i++) oview.setUint32(4 * i, state[i], isLE);
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
	_cloneIntoMeta(to) {
		const { buffer, length, finished, destroyed, pos } = this;
		to.destroyed = destroyed;
		to.finished = finished;
		to.length = length;
		to.pos = pos;
		if (pos) to.buffer.set(buffer);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
};
/**
* Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
* Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
*/
/** Initial SHA256 state from RFC 6234 §6.1: the first 32 bits of the fractional parts of the
* square roots of the first eight prime numbers. Exported as a shared table; callers must treat
* it as read-only because constructors copy words from it by index. */
const SHA256_IV = /* @__PURE__ */ Uint32Array.from([
	0x6a09e667,
	0xbb67ae85,
	0x3c6ef372,
	0xa54ff53a,
	0x510e527f,
	0x9b05688c,
	528734635,
	0x5be0cd19
]);
// node_modules/@noble/hashes/sha2.js
/**
* SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
* SHA256 is the fastest hash implementable in JS, even faster than Blake3.
* Check out {@link https://www.rfc-editor.org/rfc/rfc4634 | RFC 4634} and
* {@link https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf | FIPS 180-4}.
* @module
*/
/**
* SHA-224 / SHA-256 round constants from RFC 6234 §5.1: the first 32 bits
* of the cube roots of the first 64 primes (2..311).
*/
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
	0x428a2f98,
	0x71374491,
	0xb5c0fbcf,
	0xe9b5dba5,
	961987163,
	0x59f111f1,
	0x923f82a4,
	0xab1c5ed5,
	0xd807aa98,
	310598401,
	607225278,
	0x550c7dc3,
	0x72be5d74,
	0x80deb1fe,
	0x9bdc06a7,
	0xc19bf174,
	0xe49b69c1,
	0xefbe4786,
	0xfc19dc6,
	604807628,
	770255983,
	0x4a7484aa,
	0x5cb0a9dc,
	0x76f988da,
	0x983e5152,
	0xa831c66d,
	0xb00327c8,
	0xbf597fc7,
	0xc6e00bf3,
	0xd5a79147,
	0x6ca6351,
	338241895,
	666307205,
	773529912,
	0x4d2c6dfc,
	0x53380d13,
	0x650a7354,
	0x766a0abb,
	0x81c2c92e,
	0x92722c85,
	0xa2bfe8a1,
	0xa81a664b,
	0xc24b8b70,
	0xc76c51a3,
	0xd192e819,
	0xd6990624,
	0xf40e3585,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	0x4ed8aa4a,
	0x5b9cca4f,
	0x682e6ff3,
	0x748f82ee,
	0x78a5636f,
	0x84c87814,
	0x8cc70208,
	0x90befffa,
	0xa4506ceb,
	0xbef9a3f7,
	0xc67178f2
]);
/** Reusable SHA-224 / SHA-256 message schedule buffer `W_t` from RFC 6234 §6.2 step 1. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
/** Internal SHA-224 / SHA-256 compression engine from RFC 6234 §6.2. */
var SHA2_32B = class extends HashMD {
	A = 0;
	B = 0;
	C = 0;
	D = 0;
	E = 0;
	F = 0;
	G = 0;
	H = 0;
	constructor(outputLen, IV) {
		super(64, outputLen, 8, false);
		this.A = IV[0] | 0;
		this.B = IV[1] | 0;
		this.C = IV[2] | 0;
		this.D = IV[3] | 0;
		this.E = IV[4] | 0;
		this.F = IV[5] | 0;
		this.G = IV[6] | 0;
		this.H = IV[7] | 0;
	}
	get() {
		const { A, B, C, D, E, F, G, H } = this;
		return [
			A,
			B,
			C,
			D,
			E,
			F,
			G,
			H
		];
	}
	set(A, B, C, D, E, F, G, H) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
		this.F = F | 0;
		this.G = G | 0;
		this.H = H | 0;
	}
	_cloneInto(to) {
		(to ||= new this.constructor()).set(...this.get());
		return this._cloneIntoMeta(to);
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA256_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 64; i++) {
			const W15 = SHA256_W[i - 15];
			const W2 = SHA256_W[i - 2];
			const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
			const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
			SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
		}
		let { A, B, C, D, E, F, G, H } = this;
		for (let i = 0; i < 64; i++) {
			const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
			const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
			const T2 = (rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + Maj(A, B, C) | 0;
			H = G;
			G = F;
			F = E;
			E = D + T1 | 0;
			D = C;
			C = B;
			B = A;
			A = T1 + T2 | 0;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		F = F + this.F | 0;
		G = G + this.G | 0;
		H = H + this.H | 0;
		this.set(A, B, C, D, E, F, G, H);
	}
	roundClean() {
		clean(SHA256_W);
	}
	destroy() {
		this.destroyed = true;
		this.set(0, 0, 0, 0, 0, 0, 0, 0);
		clean(this.buffer);
	}
};
/** Internal SHA-256 hash class grounded in RFC 6234 §6.2. */
var _SHA256 = class extends SHA2_32B {
	constructor() {
		super(32, SHA256_IV);
	}
};
/**
* SHA2-256 hash function from RFC 4634. In JS it's the fastest: even faster than Blake3. Some info:
*
* - Trying 2^128 hashes would get 50% chance of collision, using birthday attack.
* - BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
* - Each sha256 hash is executing 2^18 bit operations.
* - Good 2024 ASICs can do 200Th/sec with 3500 watts of power, corresponding to 2^36 hashes/joule.
* @param msg - message bytes to hash
* @param opts - Reserved hash options.
* @returns Digest bytes.
* @example
* Hash a message with SHA2-256.
* ```ts
* sha256(new Uint8Array([97, 98, 99]));
* ```
*/
const sha256 = /* @__PURE__ */ createHasher(() => new _SHA256(), /* @__PURE__ */ oidNist(1));
export { sha256 };
