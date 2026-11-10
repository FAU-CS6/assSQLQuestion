var QSS = (function (exports) {
	'use strict';

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function getDefaultExportFromCjs (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
	}

	var sqlite = {};

	var BigInteger = {exports: {}};

	var hasRequiredBigInteger;

	function requireBigInteger () {
		if (hasRequiredBigInteger) return BigInteger.exports;
		hasRequiredBigInteger = 1;
		(function (module) {
			var bigInt = (function (undefined$1) {

			    var BASE = 1e7,
			        LOG_BASE = 7,
			        MAX_INT = 9007199254740992,
			        MAX_INT_ARR = smallToArray(MAX_INT),
			        DEFAULT_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

			    var supportsNativeBigInt = typeof BigInt === "function";

			    function Integer(v, radix, alphabet, caseSensitive) {
			        if (typeof v === "undefined") return Integer[0];
			        if (typeof radix !== "undefined") return +radix === 10 && !alphabet ? parseValue(v) : parseBase(v, radix, alphabet, caseSensitive);
			        return parseValue(v);
			    }

			    function BigInteger(value, sign) {
			        this.value = value;
			        this.sign = sign;
			        this.isSmall = false;
			    }
			    BigInteger.prototype = Object.create(Integer.prototype);

			    function SmallInteger(value) {
			        this.value = value;
			        this.sign = value < 0;
			        this.isSmall = true;
			    }
			    SmallInteger.prototype = Object.create(Integer.prototype);

			    function NativeBigInt(value) {
			        this.value = value;
			    }
			    NativeBigInt.prototype = Object.create(Integer.prototype);

			    function isPrecise(n) {
			        return -MAX_INT < n && n < MAX_INT;
			    }

			    function smallToArray(n) { // For performance reasons doesn't reference BASE, need to change this function if BASE changes
			        if (n < 1e7)
			            return [n];
			        if (n < 1e14)
			            return [n % 1e7, Math.floor(n / 1e7)];
			        return [n % 1e7, Math.floor(n / 1e7) % 1e7, Math.floor(n / 1e14)];
			    }

			    function arrayToSmall(arr) { // If BASE changes this function may need to change
			        trim(arr);
			        var length = arr.length;
			        if (length < 4 && compareAbs(arr, MAX_INT_ARR) < 0) {
			            switch (length) {
			                case 0: return 0;
			                case 1: return arr[0];
			                case 2: return arr[0] + arr[1] * BASE;
			                default: return arr[0] + (arr[1] + arr[2] * BASE) * BASE;
			            }
			        }
			        return arr;
			    }

			    function trim(v) {
			        var i = v.length;
			        while (v[--i] === 0);
			        v.length = i + 1;
			    }

			    function createArray(length) { // function shamelessly stolen from Yaffle's library https://github.com/Yaffle/BigInteger
			        var x = new Array(length);
			        var i = -1;
			        while (++i < length) {
			            x[i] = 0;
			        }
			        return x;
			    }

			    function truncate(n) {
			        if (n > 0) return Math.floor(n);
			        return Math.ceil(n);
			    }

			    function add(a, b) { // assumes a and b are arrays with a.length >= b.length
			        var l_a = a.length,
			            l_b = b.length,
			            r = new Array(l_a),
			            carry = 0,
			            base = BASE,
			            sum, i;
			        for (i = 0; i < l_b; i++) {
			            sum = a[i] + b[i] + carry;
			            carry = sum >= base ? 1 : 0;
			            r[i] = sum - carry * base;
			        }
			        while (i < l_a) {
			            sum = a[i] + carry;
			            carry = sum === base ? 1 : 0;
			            r[i++] = sum - carry * base;
			        }
			        if (carry > 0) r.push(carry);
			        return r;
			    }

			    function addAny(a, b) {
			        if (a.length >= b.length) return add(a, b);
			        return add(b, a);
			    }

			    function addSmall(a, carry) { // assumes a is array, carry is number with 0 <= carry < MAX_INT
			        var l = a.length,
			            r = new Array(l),
			            base = BASE,
			            sum, i;
			        for (i = 0; i < l; i++) {
			            sum = a[i] - base + carry;
			            carry = Math.floor(sum / base);
			            r[i] = sum - carry * base;
			            carry += 1;
			        }
			        while (carry > 0) {
			            r[i++] = carry % base;
			            carry = Math.floor(carry / base);
			        }
			        return r;
			    }

			    BigInteger.prototype.add = function (v) {
			        var n = parseValue(v);
			        if (this.sign !== n.sign) {
			            return this.subtract(n.negate());
			        }
			        var a = this.value, b = n.value;
			        if (n.isSmall) {
			            return new BigInteger(addSmall(a, Math.abs(b)), this.sign);
			        }
			        return new BigInteger(addAny(a, b), this.sign);
			    };
			    BigInteger.prototype.plus = BigInteger.prototype.add;

			    SmallInteger.prototype.add = function (v) {
			        var n = parseValue(v);
			        var a = this.value;
			        if (a < 0 !== n.sign) {
			            return this.subtract(n.negate());
			        }
			        var b = n.value;
			        if (n.isSmall) {
			            if (isPrecise(a + b)) return new SmallInteger(a + b);
			            b = smallToArray(Math.abs(b));
			        }
			        return new BigInteger(addSmall(b, Math.abs(a)), a < 0);
			    };
			    SmallInteger.prototype.plus = SmallInteger.prototype.add;

			    NativeBigInt.prototype.add = function (v) {
			        return new NativeBigInt(this.value + parseValue(v).value);
			    };
			    NativeBigInt.prototype.plus = NativeBigInt.prototype.add;

			    function subtract(a, b) { // assumes a and b are arrays with a >= b
			        var a_l = a.length,
			            b_l = b.length,
			            r = new Array(a_l),
			            borrow = 0,
			            base = BASE,
			            i, difference;
			        for (i = 0; i < b_l; i++) {
			            difference = a[i] - borrow - b[i];
			            if (difference < 0) {
			                difference += base;
			                borrow = 1;
			            } else borrow = 0;
			            r[i] = difference;
			        }
			        for (i = b_l; i < a_l; i++) {
			            difference = a[i] - borrow;
			            if (difference < 0) difference += base;
			            else {
			                r[i++] = difference;
			                break;
			            }
			            r[i] = difference;
			        }
			        for (; i < a_l; i++) {
			            r[i] = a[i];
			        }
			        trim(r);
			        return r;
			    }

			    function subtractAny(a, b, sign) {
			        var value;
			        if (compareAbs(a, b) >= 0) {
			            value = subtract(a, b);
			        } else {
			            value = subtract(b, a);
			            sign = !sign;
			        }
			        value = arrayToSmall(value);
			        if (typeof value === "number") {
			            if (sign) value = -value;
			            return new SmallInteger(value);
			        }
			        return new BigInteger(value, sign);
			    }

			    function subtractSmall(a, b, sign) { // assumes a is array, b is number with 0 <= b < MAX_INT
			        var l = a.length,
			            r = new Array(l),
			            carry = -b,
			            base = BASE,
			            i, difference;
			        for (i = 0; i < l; i++) {
			            difference = a[i] + carry;
			            carry = Math.floor(difference / base);
			            difference %= base;
			            r[i] = difference < 0 ? difference + base : difference;
			        }
			        r = arrayToSmall(r);
			        if (typeof r === "number") {
			            if (sign) r = -r;
			            return new SmallInteger(r);
			        } return new BigInteger(r, sign);
			    }

			    BigInteger.prototype.subtract = function (v) {
			        var n = parseValue(v);
			        if (this.sign !== n.sign) {
			            return this.add(n.negate());
			        }
			        var a = this.value, b = n.value;
			        if (n.isSmall)
			            return subtractSmall(a, Math.abs(b), this.sign);
			        return subtractAny(a, b, this.sign);
			    };
			    BigInteger.prototype.minus = BigInteger.prototype.subtract;

			    SmallInteger.prototype.subtract = function (v) {
			        var n = parseValue(v);
			        var a = this.value;
			        if (a < 0 !== n.sign) {
			            return this.add(n.negate());
			        }
			        var b = n.value;
			        if (n.isSmall) {
			            return new SmallInteger(a - b);
			        }
			        return subtractSmall(b, Math.abs(a), a >= 0);
			    };
			    SmallInteger.prototype.minus = SmallInteger.prototype.subtract;

			    NativeBigInt.prototype.subtract = function (v) {
			        return new NativeBigInt(this.value - parseValue(v).value);
			    };
			    NativeBigInt.prototype.minus = NativeBigInt.prototype.subtract;

			    BigInteger.prototype.negate = function () {
			        return new BigInteger(this.value, !this.sign);
			    };
			    SmallInteger.prototype.negate = function () {
			        var sign = this.sign;
			        var small = new SmallInteger(-this.value);
			        small.sign = !sign;
			        return small;
			    };
			    NativeBigInt.prototype.negate = function () {
			        return new NativeBigInt(-this.value);
			    };

			    BigInteger.prototype.abs = function () {
			        return new BigInteger(this.value, false);
			    };
			    SmallInteger.prototype.abs = function () {
			        return new SmallInteger(Math.abs(this.value));
			    };
			    NativeBigInt.prototype.abs = function () {
			        return new NativeBigInt(this.value >= 0 ? this.value : -this.value);
			    };


			    function multiplyLong(a, b) {
			        var a_l = a.length,
			            b_l = b.length,
			            l = a_l + b_l,
			            r = createArray(l),
			            base = BASE,
			            product, carry, i, a_i, b_j;
			        for (i = 0; i < a_l; ++i) {
			            a_i = a[i];
			            for (var j = 0; j < b_l; ++j) {
			                b_j = b[j];
			                product = a_i * b_j + r[i + j];
			                carry = Math.floor(product / base);
			                r[i + j] = product - carry * base;
			                r[i + j + 1] += carry;
			            }
			        }
			        trim(r);
			        return r;
			    }

			    function multiplySmall(a, b) { // assumes a is array, b is number with |b| < BASE
			        var l = a.length,
			            r = new Array(l),
			            base = BASE,
			            carry = 0,
			            product, i;
			        for (i = 0; i < l; i++) {
			            product = a[i] * b + carry;
			            carry = Math.floor(product / base);
			            r[i] = product - carry * base;
			        }
			        while (carry > 0) {
			            r[i++] = carry % base;
			            carry = Math.floor(carry / base);
			        }
			        return r;
			    }

			    function shiftLeft(x, n) {
			        var r = [];
			        while (n-- > 0) r.push(0);
			        return r.concat(x);
			    }

			    function multiplyKaratsuba(x, y) {
			        var n = Math.max(x.length, y.length);

			        if (n <= 30) return multiplyLong(x, y);
			        n = Math.ceil(n / 2);

			        var b = x.slice(n),
			            a = x.slice(0, n),
			            d = y.slice(n),
			            c = y.slice(0, n);

			        var ac = multiplyKaratsuba(a, c),
			            bd = multiplyKaratsuba(b, d),
			            abcd = multiplyKaratsuba(addAny(a, b), addAny(c, d));

			        var product = addAny(addAny(ac, shiftLeft(subtract(subtract(abcd, ac), bd), n)), shiftLeft(bd, 2 * n));
			        trim(product);
			        return product;
			    }

			    // The following function is derived from a surface fit of a graph plotting the performance difference
			    // between long multiplication and karatsuba multiplication versus the lengths of the two arrays.
			    function useKaratsuba(l1, l2) {
			        return -0.012 * l1 - 0.012 * l2 + 0.000015 * l1 * l2 > 0;
			    }

			    BigInteger.prototype.multiply = function (v) {
			        var n = parseValue(v),
			            a = this.value, b = n.value,
			            sign = this.sign !== n.sign,
			            abs;
			        if (n.isSmall) {
			            if (b === 0) return Integer[0];
			            if (b === 1) return this;
			            if (b === -1) return this.negate();
			            abs = Math.abs(b);
			            if (abs < BASE) {
			                return new BigInteger(multiplySmall(a, abs), sign);
			            }
			            b = smallToArray(abs);
			        }
			        if (useKaratsuba(a.length, b.length)) // Karatsuba is only faster for certain array sizes
			            return new BigInteger(multiplyKaratsuba(a, b), sign);
			        return new BigInteger(multiplyLong(a, b), sign);
			    };

			    BigInteger.prototype.times = BigInteger.prototype.multiply;

			    function multiplySmallAndArray(a, b, sign) { // a >= 0
			        if (a < BASE) {
			            return new BigInteger(multiplySmall(b, a), sign);
			        }
			        return new BigInteger(multiplyLong(b, smallToArray(a)), sign);
			    }
			    SmallInteger.prototype._multiplyBySmall = function (a) {
			        if (isPrecise(a.value * this.value)) {
			            return new SmallInteger(a.value * this.value);
			        }
			        return multiplySmallAndArray(Math.abs(a.value), smallToArray(Math.abs(this.value)), this.sign !== a.sign);
			    };
			    BigInteger.prototype._multiplyBySmall = function (a) {
			        if (a.value === 0) return Integer[0];
			        if (a.value === 1) return this;
			        if (a.value === -1) return this.negate();
			        return multiplySmallAndArray(Math.abs(a.value), this.value, this.sign !== a.sign);
			    };
			    SmallInteger.prototype.multiply = function (v) {
			        return parseValue(v)._multiplyBySmall(this);
			    };
			    SmallInteger.prototype.times = SmallInteger.prototype.multiply;

			    NativeBigInt.prototype.multiply = function (v) {
			        return new NativeBigInt(this.value * parseValue(v).value);
			    };
			    NativeBigInt.prototype.times = NativeBigInt.prototype.multiply;

			    function square(a) {
			        //console.assert(2 * BASE * BASE < MAX_INT);
			        var l = a.length,
			            r = createArray(l + l),
			            base = BASE,
			            product, carry, i, a_i, a_j;
			        for (i = 0; i < l; i++) {
			            a_i = a[i];
			            carry = 0 - a_i * a_i;
			            for (var j = i; j < l; j++) {
			                a_j = a[j];
			                product = 2 * (a_i * a_j) + r[i + j] + carry;
			                carry = Math.floor(product / base);
			                r[i + j] = product - carry * base;
			            }
			            r[i + l] = carry;
			        }
			        trim(r);
			        return r;
			    }

			    BigInteger.prototype.square = function () {
			        return new BigInteger(square(this.value), false);
			    };

			    SmallInteger.prototype.square = function () {
			        var value = this.value * this.value;
			        if (isPrecise(value)) return new SmallInteger(value);
			        return new BigInteger(square(smallToArray(Math.abs(this.value))), false);
			    };

			    NativeBigInt.prototype.square = function (v) {
			        return new NativeBigInt(this.value * this.value);
			    };

			    function divMod1(a, b) { // Left over from previous version. Performs faster than divMod2 on smaller input sizes.
			        var a_l = a.length,
			            b_l = b.length,
			            base = BASE,
			            result = createArray(b.length),
			            divisorMostSignificantDigit = b[b_l - 1],
			            // normalization
			            lambda = Math.ceil(base / (2 * divisorMostSignificantDigit)),
			            remainder = multiplySmall(a, lambda),
			            divisor = multiplySmall(b, lambda),
			            quotientDigit, shift, carry, borrow, i, l, q;
			        if (remainder.length <= a_l) remainder.push(0);
			        divisor.push(0);
			        divisorMostSignificantDigit = divisor[b_l - 1];
			        for (shift = a_l - b_l; shift >= 0; shift--) {
			            quotientDigit = base - 1;
			            if (remainder[shift + b_l] !== divisorMostSignificantDigit) {
			                quotientDigit = Math.floor((remainder[shift + b_l] * base + remainder[shift + b_l - 1]) / divisorMostSignificantDigit);
			            }
			            // quotientDigit <= base - 1
			            carry = 0;
			            borrow = 0;
			            l = divisor.length;
			            for (i = 0; i < l; i++) {
			                carry += quotientDigit * divisor[i];
			                q = Math.floor(carry / base);
			                borrow += remainder[shift + i] - (carry - q * base);
			                carry = q;
			                if (borrow < 0) {
			                    remainder[shift + i] = borrow + base;
			                    borrow = -1;
			                } else {
			                    remainder[shift + i] = borrow;
			                    borrow = 0;
			                }
			            }
			            while (borrow !== 0) {
			                quotientDigit -= 1;
			                carry = 0;
			                for (i = 0; i < l; i++) {
			                    carry += remainder[shift + i] - base + divisor[i];
			                    if (carry < 0) {
			                        remainder[shift + i] = carry + base;
			                        carry = 0;
			                    } else {
			                        remainder[shift + i] = carry;
			                        carry = 1;
			                    }
			                }
			                borrow += carry;
			            }
			            result[shift] = quotientDigit;
			        }
			        // denormalization
			        remainder = divModSmall(remainder, lambda)[0];
			        return [arrayToSmall(result), arrayToSmall(remainder)];
			    }

			    function divMod2(a, b) { // Implementation idea shamelessly stolen from Silent Matt's library http://silentmatt.com/biginteger/
			        // Performs faster than divMod1 on larger input sizes.
			        var a_l = a.length,
			            b_l = b.length,
			            result = [],
			            part = [],
			            base = BASE,
			            guess, xlen, highx, highy, check;
			        while (a_l) {
			            part.unshift(a[--a_l]);
			            trim(part);
			            if (compareAbs(part, b) < 0) {
			                result.push(0);
			                continue;
			            }
			            xlen = part.length;
			            highx = part[xlen - 1] * base + part[xlen - 2];
			            highy = b[b_l - 1] * base + b[b_l - 2];
			            if (xlen > b_l) {
			                highx = (highx + 1) * base;
			            }
			            guess = Math.ceil(highx / highy);
			            do {
			                check = multiplySmall(b, guess);
			                if (compareAbs(check, part) <= 0) break;
			                guess--;
			            } while (guess);
			            result.push(guess);
			            part = subtract(part, check);
			        }
			        result.reverse();
			        return [arrayToSmall(result), arrayToSmall(part)];
			    }

			    function divModSmall(value, lambda) {
			        var length = value.length,
			            quotient = createArray(length),
			            base = BASE,
			            i, q, remainder, divisor;
			        remainder = 0;
			        for (i = length - 1; i >= 0; --i) {
			            divisor = remainder * base + value[i];
			            q = truncate(divisor / lambda);
			            remainder = divisor - q * lambda;
			            quotient[i] = q | 0;
			        }
			        return [quotient, remainder | 0];
			    }

			    function divModAny(self, v) {
			        var value, n = parseValue(v);
			        if (supportsNativeBigInt) {
			            return [new NativeBigInt(self.value / n.value), new NativeBigInt(self.value % n.value)];
			        }
			        var a = self.value, b = n.value;
			        var quotient;
			        if (b === 0) throw new Error("Cannot divide by zero");
			        if (self.isSmall) {
			            if (n.isSmall) {
			                return [new SmallInteger(truncate(a / b)), new SmallInteger(a % b)];
			            }
			            return [Integer[0], self];
			        }
			        if (n.isSmall) {
			            if (b === 1) return [self, Integer[0]];
			            if (b == -1) return [self.negate(), Integer[0]];
			            var abs = Math.abs(b);
			            if (abs < BASE) {
			                value = divModSmall(a, abs);
			                quotient = arrayToSmall(value[0]);
			                var remainder = value[1];
			                if (self.sign) remainder = -remainder;
			                if (typeof quotient === "number") {
			                    if (self.sign !== n.sign) quotient = -quotient;
			                    return [new SmallInteger(quotient), new SmallInteger(remainder)];
			                }
			                return [new BigInteger(quotient, self.sign !== n.sign), new SmallInteger(remainder)];
			            }
			            b = smallToArray(abs);
			        }
			        var comparison = compareAbs(a, b);
			        if (comparison === -1) return [Integer[0], self];
			        if (comparison === 0) return [Integer[self.sign === n.sign ? 1 : -1], Integer[0]];

			        // divMod1 is faster on smaller input sizes
			        if (a.length + b.length <= 200)
			            value = divMod1(a, b);
			        else value = divMod2(a, b);

			        quotient = value[0];
			        var qSign = self.sign !== n.sign,
			            mod = value[1],
			            mSign = self.sign;
			        if (typeof quotient === "number") {
			            if (qSign) quotient = -quotient;
			            quotient = new SmallInteger(quotient);
			        } else quotient = new BigInteger(quotient, qSign);
			        if (typeof mod === "number") {
			            if (mSign) mod = -mod;
			            mod = new SmallInteger(mod);
			        } else mod = new BigInteger(mod, mSign);
			        return [quotient, mod];
			    }

			    BigInteger.prototype.divmod = function (v) {
			        var result = divModAny(this, v);
			        return {
			            quotient: result[0],
			            remainder: result[1]
			        };
			    };
			    NativeBigInt.prototype.divmod = SmallInteger.prototype.divmod = BigInteger.prototype.divmod;


			    BigInteger.prototype.divide = function (v) {
			        return divModAny(this, v)[0];
			    };
			    NativeBigInt.prototype.over = NativeBigInt.prototype.divide = function (v) {
			        return new NativeBigInt(this.value / parseValue(v).value);
			    };
			    SmallInteger.prototype.over = SmallInteger.prototype.divide = BigInteger.prototype.over = BigInteger.prototype.divide;

			    BigInteger.prototype.mod = function (v) {
			        return divModAny(this, v)[1];
			    };
			    NativeBigInt.prototype.mod = NativeBigInt.prototype.remainder = function (v) {
			        return new NativeBigInt(this.value % parseValue(v).value);
			    };
			    SmallInteger.prototype.remainder = SmallInteger.prototype.mod = BigInteger.prototype.remainder = BigInteger.prototype.mod;

			    BigInteger.prototype.pow = function (v) {
			        var n = parseValue(v),
			            a = this.value,
			            b = n.value,
			            value, x, y;
			        if (b === 0) return Integer[1];
			        if (a === 0) return Integer[0];
			        if (a === 1) return Integer[1];
			        if (a === -1) return n.isEven() ? Integer[1] : Integer[-1];
			        if (n.sign) {
			            return Integer[0];
			        }
			        if (!n.isSmall) throw new Error("The exponent " + n.toString() + " is too large.");
			        if (this.isSmall) {
			            if (isPrecise(value = Math.pow(a, b)))
			                return new SmallInteger(truncate(value));
			        }
			        x = this;
			        y = Integer[1];
			        while (true) {
			            if (b & 1 === 1) {
			                y = y.times(x);
			                --b;
			            }
			            if (b === 0) break;
			            b /= 2;
			            x = x.square();
			        }
			        return y;
			    };
			    SmallInteger.prototype.pow = BigInteger.prototype.pow;

			    NativeBigInt.prototype.pow = function (v) {
			        var n = parseValue(v);
			        var a = this.value, b = n.value;
			        var _0 = BigInt(0), _1 = BigInt(1), _2 = BigInt(2);
			        if (b === _0) return Integer[1];
			        if (a === _0) return Integer[0];
			        if (a === _1) return Integer[1];
			        if (a === BigInt(-1)) return n.isEven() ? Integer[1] : Integer[-1];
			        if (n.isNegative()) return new NativeBigInt(_0);
			        var x = this;
			        var y = Integer[1];
			        while (true) {
			            if ((b & _1) === _1) {
			                y = y.times(x);
			                --b;
			            }
			            if (b === _0) break;
			            b /= _2;
			            x = x.square();
			        }
			        return y;
			    };

			    BigInteger.prototype.modPow = function (exp, mod) {
			        exp = parseValue(exp);
			        mod = parseValue(mod);
			        if (mod.isZero()) throw new Error("Cannot take modPow with modulus 0");
			        var r = Integer[1],
			            base = this.mod(mod);
			        if (exp.isNegative()) {
			            exp = exp.multiply(Integer[-1]);
			            base = base.modInv(mod);
			        }
			        while (exp.isPositive()) {
			            if (base.isZero()) return Integer[0];
			            if (exp.isOdd()) r = r.multiply(base).mod(mod);
			            exp = exp.divide(2);
			            base = base.square().mod(mod);
			        }
			        return r;
			    };
			    NativeBigInt.prototype.modPow = SmallInteger.prototype.modPow = BigInteger.prototype.modPow;

			    function compareAbs(a, b) {
			        if (a.length !== b.length) {
			            return a.length > b.length ? 1 : -1;
			        }
			        for (var i = a.length - 1; i >= 0; i--) {
			            if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
			        }
			        return 0;
			    }

			    BigInteger.prototype.compareAbs = function (v) {
			        var n = parseValue(v),
			            a = this.value,
			            b = n.value;
			        if (n.isSmall) return 1;
			        return compareAbs(a, b);
			    };
			    SmallInteger.prototype.compareAbs = function (v) {
			        var n = parseValue(v),
			            a = Math.abs(this.value),
			            b = n.value;
			        if (n.isSmall) {
			            b = Math.abs(b);
			            return a === b ? 0 : a > b ? 1 : -1;
			        }
			        return -1;
			    };
			    NativeBigInt.prototype.compareAbs = function (v) {
			        var a = this.value;
			        var b = parseValue(v).value;
			        a = a >= 0 ? a : -a;
			        b = b >= 0 ? b : -b;
			        return a === b ? 0 : a > b ? 1 : -1;
			    };

			    BigInteger.prototype.compare = function (v) {
			        // See discussion about comparison with Infinity:
			        // https://github.com/peterolson/BigInteger.js/issues/61
			        if (v === Infinity) {
			            return -1;
			        }
			        if (v === -Infinity) {
			            return 1;
			        }

			        var n = parseValue(v),
			            a = this.value,
			            b = n.value;
			        if (this.sign !== n.sign) {
			            return n.sign ? 1 : -1;
			        }
			        if (n.isSmall) {
			            return this.sign ? -1 : 1;
			        }
			        return compareAbs(a, b) * (this.sign ? -1 : 1);
			    };
			    BigInteger.prototype.compareTo = BigInteger.prototype.compare;

			    SmallInteger.prototype.compare = function (v) {
			        if (v === Infinity) {
			            return -1;
			        }
			        if (v === -Infinity) {
			            return 1;
			        }

			        var n = parseValue(v),
			            a = this.value,
			            b = n.value;
			        if (n.isSmall) {
			            return a == b ? 0 : a > b ? 1 : -1;
			        }
			        if (a < 0 !== n.sign) {
			            return a < 0 ? -1 : 1;
			        }
			        return a < 0 ? 1 : -1;
			    };
			    SmallInteger.prototype.compareTo = SmallInteger.prototype.compare;

			    NativeBigInt.prototype.compare = function (v) {
			        if (v === Infinity) {
			            return -1;
			        }
			        if (v === -Infinity) {
			            return 1;
			        }
			        var a = this.value;
			        var b = parseValue(v).value;
			        return a === b ? 0 : a > b ? 1 : -1;
			    };
			    NativeBigInt.prototype.compareTo = NativeBigInt.prototype.compare;

			    BigInteger.prototype.equals = function (v) {
			        return this.compare(v) === 0;
			    };
			    NativeBigInt.prototype.eq = NativeBigInt.prototype.equals = SmallInteger.prototype.eq = SmallInteger.prototype.equals = BigInteger.prototype.eq = BigInteger.prototype.equals;

			    BigInteger.prototype.notEquals = function (v) {
			        return this.compare(v) !== 0;
			    };
			    NativeBigInt.prototype.neq = NativeBigInt.prototype.notEquals = SmallInteger.prototype.neq = SmallInteger.prototype.notEquals = BigInteger.prototype.neq = BigInteger.prototype.notEquals;

			    BigInteger.prototype.greater = function (v) {
			        return this.compare(v) > 0;
			    };
			    NativeBigInt.prototype.gt = NativeBigInt.prototype.greater = SmallInteger.prototype.gt = SmallInteger.prototype.greater = BigInteger.prototype.gt = BigInteger.prototype.greater;

			    BigInteger.prototype.lesser = function (v) {
			        return this.compare(v) < 0;
			    };
			    NativeBigInt.prototype.lt = NativeBigInt.prototype.lesser = SmallInteger.prototype.lt = SmallInteger.prototype.lesser = BigInteger.prototype.lt = BigInteger.prototype.lesser;

			    BigInteger.prototype.greaterOrEquals = function (v) {
			        return this.compare(v) >= 0;
			    };
			    NativeBigInt.prototype.geq = NativeBigInt.prototype.greaterOrEquals = SmallInteger.prototype.geq = SmallInteger.prototype.greaterOrEquals = BigInteger.prototype.geq = BigInteger.prototype.greaterOrEquals;

			    BigInteger.prototype.lesserOrEquals = function (v) {
			        return this.compare(v) <= 0;
			    };
			    NativeBigInt.prototype.leq = NativeBigInt.prototype.lesserOrEquals = SmallInteger.prototype.leq = SmallInteger.prototype.lesserOrEquals = BigInteger.prototype.leq = BigInteger.prototype.lesserOrEquals;

			    BigInteger.prototype.isEven = function () {
			        return (this.value[0] & 1) === 0;
			    };
			    SmallInteger.prototype.isEven = function () {
			        return (this.value & 1) === 0;
			    };
			    NativeBigInt.prototype.isEven = function () {
			        return (this.value & BigInt(1)) === BigInt(0);
			    };

			    BigInteger.prototype.isOdd = function () {
			        return (this.value[0] & 1) === 1;
			    };
			    SmallInteger.prototype.isOdd = function () {
			        return (this.value & 1) === 1;
			    };
			    NativeBigInt.prototype.isOdd = function () {
			        return (this.value & BigInt(1)) === BigInt(1);
			    };

			    BigInteger.prototype.isPositive = function () {
			        return !this.sign;
			    };
			    SmallInteger.prototype.isPositive = function () {
			        return this.value > 0;
			    };
			    NativeBigInt.prototype.isPositive = SmallInteger.prototype.isPositive;

			    BigInteger.prototype.isNegative = function () {
			        return this.sign;
			    };
			    SmallInteger.prototype.isNegative = function () {
			        return this.value < 0;
			    };
			    NativeBigInt.prototype.isNegative = SmallInteger.prototype.isNegative;

			    BigInteger.prototype.isUnit = function () {
			        return false;
			    };
			    SmallInteger.prototype.isUnit = function () {
			        return Math.abs(this.value) === 1;
			    };
			    NativeBigInt.prototype.isUnit = function () {
			        return this.abs().value === BigInt(1);
			    };

			    BigInteger.prototype.isZero = function () {
			        return false;
			    };
			    SmallInteger.prototype.isZero = function () {
			        return this.value === 0;
			    };
			    NativeBigInt.prototype.isZero = function () {
			        return this.value === BigInt(0);
			    };

			    BigInteger.prototype.isDivisibleBy = function (v) {
			        var n = parseValue(v);
			        if (n.isZero()) return false;
			        if (n.isUnit()) return true;
			        if (n.compareAbs(2) === 0) return this.isEven();
			        return this.mod(n).isZero();
			    };
			    NativeBigInt.prototype.isDivisibleBy = SmallInteger.prototype.isDivisibleBy = BigInteger.prototype.isDivisibleBy;

			    function isBasicPrime(v) {
			        var n = v.abs();
			        if (n.isUnit()) return false;
			        if (n.equals(2) || n.equals(3) || n.equals(5)) return true;
			        if (n.isEven() || n.isDivisibleBy(3) || n.isDivisibleBy(5)) return false;
			        if (n.lesser(49)) return true;
			        // we don't know if it's prime: let the other functions figure it out
			    }

			    function millerRabinTest(n, a) {
			        var nPrev = n.prev(),
			            b = nPrev,
			            r = 0,
			            d, i, x;
			        while (b.isEven()) b = b.divide(2), r++;
			        next: for (i = 0; i < a.length; i++) {
			            if (n.lesser(a[i])) continue;
			            x = bigInt(a[i]).modPow(b, n);
			            if (x.isUnit() || x.equals(nPrev)) continue;
			            for (d = r - 1; d != 0; d--) {
			                x = x.square().mod(n);
			                if (x.isUnit()) return false;
			                if (x.equals(nPrev)) continue next;
			            }
			            return false;
			        }
			        return true;
			    }

			    // Set "strict" to true to force GRH-supported lower bound of 2*log(N)^2
			    BigInteger.prototype.isPrime = function (strict) {
			        var isPrime = isBasicPrime(this);
			        if (isPrime !== undefined$1) return isPrime;
			        var n = this.abs();
			        var bits = n.bitLength();
			        if (bits <= 64)
			            return millerRabinTest(n, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]);
			        var logN = Math.log(2) * bits.toJSNumber();
			        var t = Math.ceil((strict === true) ? (2 * Math.pow(logN, 2)) : logN);
			        for (var a = [], i = 0; i < t; i++) {
			            a.push(bigInt(i + 2));
			        }
			        return millerRabinTest(n, a);
			    };
			    NativeBigInt.prototype.isPrime = SmallInteger.prototype.isPrime = BigInteger.prototype.isPrime;

			    BigInteger.prototype.isProbablePrime = function (iterations, rng) {
			        var isPrime = isBasicPrime(this);
			        if (isPrime !== undefined$1) return isPrime;
			        var n = this.abs();
			        var t = iterations === undefined$1 ? 5 : iterations;
			        for (var a = [], i = 0; i < t; i++) {
			            a.push(bigInt.randBetween(2, n.minus(2), rng));
			        }
			        return millerRabinTest(n, a);
			    };
			    NativeBigInt.prototype.isProbablePrime = SmallInteger.prototype.isProbablePrime = BigInteger.prototype.isProbablePrime;

			    BigInteger.prototype.modInv = function (n) {
			        var t = bigInt.zero, newT = bigInt.one, r = parseValue(n), newR = this.abs(), q, lastT, lastR;
			        while (!newR.isZero()) {
			            q = r.divide(newR);
			            lastT = t;
			            lastR = r;
			            t = newT;
			            r = newR;
			            newT = lastT.subtract(q.multiply(newT));
			            newR = lastR.subtract(q.multiply(newR));
			        }
			        if (!r.isUnit()) throw new Error(this.toString() + " and " + n.toString() + " are not co-prime");
			        if (t.compare(0) === -1) {
			            t = t.add(n);
			        }
			        if (this.isNegative()) {
			            return t.negate();
			        }
			        return t;
			    };

			    NativeBigInt.prototype.modInv = SmallInteger.prototype.modInv = BigInteger.prototype.modInv;

			    BigInteger.prototype.next = function () {
			        var value = this.value;
			        if (this.sign) {
			            return subtractSmall(value, 1, this.sign);
			        }
			        return new BigInteger(addSmall(value, 1), this.sign);
			    };
			    SmallInteger.prototype.next = function () {
			        var value = this.value;
			        if (value + 1 < MAX_INT) return new SmallInteger(value + 1);
			        return new BigInteger(MAX_INT_ARR, false);
			    };
			    NativeBigInt.prototype.next = function () {
			        return new NativeBigInt(this.value + BigInt(1));
			    };

			    BigInteger.prototype.prev = function () {
			        var value = this.value;
			        if (this.sign) {
			            return new BigInteger(addSmall(value, 1), true);
			        }
			        return subtractSmall(value, 1, this.sign);
			    };
			    SmallInteger.prototype.prev = function () {
			        var value = this.value;
			        if (value - 1 > -MAX_INT) return new SmallInteger(value - 1);
			        return new BigInteger(MAX_INT_ARR, true);
			    };
			    NativeBigInt.prototype.prev = function () {
			        return new NativeBigInt(this.value - BigInt(1));
			    };

			    var powersOfTwo = [1];
			    while (2 * powersOfTwo[powersOfTwo.length - 1] <= BASE) powersOfTwo.push(2 * powersOfTwo[powersOfTwo.length - 1]);
			    var powers2Length = powersOfTwo.length, highestPower2 = powersOfTwo[powers2Length - 1];

			    function shift_isSmall(n) {
			        return Math.abs(n) <= BASE;
			    }

			    BigInteger.prototype.shiftLeft = function (v) {
			        var n = parseValue(v).toJSNumber();
			        if (!shift_isSmall(n)) {
			            throw new Error(String(n) + " is too large for shifting.");
			        }
			        if (n < 0) return this.shiftRight(-n);
			        var result = this;
			        if (result.isZero()) return result;
			        while (n >= powers2Length) {
			            result = result.multiply(highestPower2);
			            n -= powers2Length - 1;
			        }
			        return result.multiply(powersOfTwo[n]);
			    };
			    NativeBigInt.prototype.shiftLeft = SmallInteger.prototype.shiftLeft = BigInteger.prototype.shiftLeft;

			    BigInteger.prototype.shiftRight = function (v) {
			        var remQuo;
			        var n = parseValue(v).toJSNumber();
			        if (!shift_isSmall(n)) {
			            throw new Error(String(n) + " is too large for shifting.");
			        }
			        if (n < 0) return this.shiftLeft(-n);
			        var result = this;
			        while (n >= powers2Length) {
			            if (result.isZero() || (result.isNegative() && result.isUnit())) return result;
			            remQuo = divModAny(result, highestPower2);
			            result = remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
			            n -= powers2Length - 1;
			        }
			        remQuo = divModAny(result, powersOfTwo[n]);
			        return remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
			    };
			    NativeBigInt.prototype.shiftRight = SmallInteger.prototype.shiftRight = BigInteger.prototype.shiftRight;

			    function bitwise(x, y, fn) {
			        y = parseValue(y);
			        var xSign = x.isNegative(), ySign = y.isNegative();
			        var xRem = xSign ? x.not() : x,
			            yRem = ySign ? y.not() : y;
			        var xDigit = 0, yDigit = 0;
			        var xDivMod = null, yDivMod = null;
			        var result = [];
			        while (!xRem.isZero() || !yRem.isZero()) {
			            xDivMod = divModAny(xRem, highestPower2);
			            xDigit = xDivMod[1].toJSNumber();
			            if (xSign) {
			                xDigit = highestPower2 - 1 - xDigit; // two's complement for negative numbers
			            }

			            yDivMod = divModAny(yRem, highestPower2);
			            yDigit = yDivMod[1].toJSNumber();
			            if (ySign) {
			                yDigit = highestPower2 - 1 - yDigit; // two's complement for negative numbers
			            }

			            xRem = xDivMod[0];
			            yRem = yDivMod[0];
			            result.push(fn(xDigit, yDigit));
			        }
			        var sum = fn(xSign ? 1 : 0, ySign ? 1 : 0) !== 0 ? bigInt(-1) : bigInt(0);
			        for (var i = result.length - 1; i >= 0; i -= 1) {
			            sum = sum.multiply(highestPower2).add(bigInt(result[i]));
			        }
			        return sum;
			    }

			    BigInteger.prototype.not = function () {
			        return this.negate().prev();
			    };
			    NativeBigInt.prototype.not = SmallInteger.prototype.not = BigInteger.prototype.not;

			    BigInteger.prototype.and = function (n) {
			        return bitwise(this, n, function (a, b) { return a & b; });
			    };
			    NativeBigInt.prototype.and = SmallInteger.prototype.and = BigInteger.prototype.and;

			    BigInteger.prototype.or = function (n) {
			        return bitwise(this, n, function (a, b) { return a | b; });
			    };
			    NativeBigInt.prototype.or = SmallInteger.prototype.or = BigInteger.prototype.or;

			    BigInteger.prototype.xor = function (n) {
			        return bitwise(this, n, function (a, b) { return a ^ b; });
			    };
			    NativeBigInt.prototype.xor = SmallInteger.prototype.xor = BigInteger.prototype.xor;

			    var LOBMASK_I = 1 << 30, LOBMASK_BI = (BASE & -BASE) * (BASE & -BASE) | LOBMASK_I;
			    function roughLOB(n) { // get lowestOneBit (rough)
			        // SmallInteger: return Min(lowestOneBit(n), 1 << 30)
			        // BigInteger: return Min(lowestOneBit(n), 1 << 14) [BASE=1e7]
			        var v = n.value,
			            x = typeof v === "number" ? v | LOBMASK_I :
			                typeof v === "bigint" ? v | BigInt(LOBMASK_I) :
			                    v[0] + v[1] * BASE | LOBMASK_BI;
			        return x & -x;
			    }

			    function integerLogarithm(value, base) {
			        if (base.compareTo(value) <= 0) {
			            var tmp = integerLogarithm(value, base.square(base));
			            var p = tmp.p;
			            var e = tmp.e;
			            var t = p.multiply(base);
			            return t.compareTo(value) <= 0 ? { p: t, e: e * 2 + 1 } : { p: p, e: e * 2 };
			        }
			        return { p: bigInt(1), e: 0 };
			    }

			    BigInteger.prototype.bitLength = function () {
			        var n = this;
			        if (n.compareTo(bigInt(0)) < 0) {
			            n = n.negate().subtract(bigInt(1));
			        }
			        if (n.compareTo(bigInt(0)) === 0) {
			            return bigInt(0);
			        }
			        return bigInt(integerLogarithm(n, bigInt(2)).e).add(bigInt(1));
			    };
			    NativeBigInt.prototype.bitLength = SmallInteger.prototype.bitLength = BigInteger.prototype.bitLength;

			    function max(a, b) {
			        a = parseValue(a);
			        b = parseValue(b);
			        return a.greater(b) ? a : b;
			    }
			    function min(a, b) {
			        a = parseValue(a);
			        b = parseValue(b);
			        return a.lesser(b) ? a : b;
			    }
			    function gcd(a, b) {
			        a = parseValue(a).abs();
			        b = parseValue(b).abs();
			        if (a.equals(b)) return a;
			        if (a.isZero()) return b;
			        if (b.isZero()) return a;
			        var c = Integer[1], d, t;
			        while (a.isEven() && b.isEven()) {
			            d = min(roughLOB(a), roughLOB(b));
			            a = a.divide(d);
			            b = b.divide(d);
			            c = c.multiply(d);
			        }
			        while (a.isEven()) {
			            a = a.divide(roughLOB(a));
			        }
			        do {
			            while (b.isEven()) {
			                b = b.divide(roughLOB(b));
			            }
			            if (a.greater(b)) {
			                t = b; b = a; a = t;
			            }
			            b = b.subtract(a);
			        } while (!b.isZero());
			        return c.isUnit() ? a : a.multiply(c);
			    }
			    function lcm(a, b) {
			        a = parseValue(a).abs();
			        b = parseValue(b).abs();
			        return a.divide(gcd(a, b)).multiply(b);
			    }
			    function randBetween(a, b, rng) {
			        a = parseValue(a);
			        b = parseValue(b);
			        var usedRNG = rng || Math.random;
			        var low = min(a, b), high = max(a, b);
			        var range = high.subtract(low).add(1);
			        if (range.isSmall) return low.add(Math.floor(usedRNG() * range));
			        var digits = toBase(range, BASE).value;
			        var result = [], restricted = true;
			        for (var i = 0; i < digits.length; i++) {
			            var top = restricted ? digits[i] + (i + 1 < digits.length ? digits[i + 1] / BASE : 0) : BASE;
			            var digit = truncate(usedRNG() * top);
			            result.push(digit);
			            if (digit < digits[i]) restricted = false;
			        }
			        return low.add(Integer.fromArray(result, BASE, false));
			    }

			    var parseBase = function (text, base, alphabet, caseSensitive) {
			        alphabet = alphabet || DEFAULT_ALPHABET;
			        text = String(text);
			        if (!caseSensitive) {
			            text = text.toLowerCase();
			            alphabet = alphabet.toLowerCase();
			        }
			        var length = text.length;
			        var i;
			        var absBase = Math.abs(base);
			        var alphabetValues = {};
			        for (i = 0; i < alphabet.length; i++) {
			            alphabetValues[alphabet[i]] = i;
			        }
			        for (i = 0; i < length; i++) {
			            var c = text[i];
			            if (c === "-") continue;
			            if (c in alphabetValues) {
			                if (alphabetValues[c] >= absBase) {
			                    if (c === "1" && absBase === 1) continue;
			                    throw new Error(c + " is not a valid digit in base " + base + ".");
			                }
			            }
			        }
			        base = parseValue(base);
			        var digits = [];
			        var isNegative = text[0] === "-";
			        for (i = isNegative ? 1 : 0; i < text.length; i++) {
			            var c = text[i];
			            if (c in alphabetValues) digits.push(parseValue(alphabetValues[c]));
			            else if (c === "<") {
			                var start = i;
			                do { i++; } while (text[i] !== ">" && i < text.length);
			                digits.push(parseValue(text.slice(start + 1, i)));
			            }
			            else throw new Error(c + " is not a valid character");
			        }
			        return parseBaseFromArray(digits, base, isNegative);
			    };

			    function parseBaseFromArray(digits, base, isNegative) {
			        var val = Integer[0], pow = Integer[1], i;
			        for (i = digits.length - 1; i >= 0; i--) {
			            val = val.add(digits[i].times(pow));
			            pow = pow.times(base);
			        }
			        return isNegative ? val.negate() : val;
			    }

			    function stringify(digit, alphabet) {
			        alphabet = alphabet || DEFAULT_ALPHABET;
			        if (digit < alphabet.length) {
			            return alphabet[digit];
			        }
			        return "<" + digit + ">";
			    }

			    function toBase(n, base) {
			        base = bigInt(base);
			        if (base.isZero()) {
			            if (n.isZero()) return { value: [0], isNegative: false };
			            throw new Error("Cannot convert nonzero numbers to base 0.");
			        }
			        if (base.equals(-1)) {
			            if (n.isZero()) return { value: [0], isNegative: false };
			            if (n.isNegative())
			                return {
			                    value: [].concat.apply([], Array.apply(null, Array(-n.toJSNumber()))
			                        .map(Array.prototype.valueOf, [1, 0])
			                    ),
			                    isNegative: false
			                };

			            var arr = Array.apply(null, Array(n.toJSNumber() - 1))
			                .map(Array.prototype.valueOf, [0, 1]);
			            arr.unshift([1]);
			            return {
			                value: [].concat.apply([], arr),
			                isNegative: false
			            };
			        }

			        var neg = false;
			        if (n.isNegative() && base.isPositive()) {
			            neg = true;
			            n = n.abs();
			        }
			        if (base.isUnit()) {
			            if (n.isZero()) return { value: [0], isNegative: false };

			            return {
			                value: Array.apply(null, Array(n.toJSNumber()))
			                    .map(Number.prototype.valueOf, 1),
			                isNegative: neg
			            };
			        }
			        var out = [];
			        var left = n, divmod;
			        while (left.isNegative() || left.compareAbs(base) >= 0) {
			            divmod = left.divmod(base);
			            left = divmod.quotient;
			            var digit = divmod.remainder;
			            if (digit.isNegative()) {
			                digit = base.minus(digit).abs();
			                left = left.next();
			            }
			            out.push(digit.toJSNumber());
			        }
			        out.push(left.toJSNumber());
			        return { value: out.reverse(), isNegative: neg };
			    }

			    function toBaseString(n, base, alphabet) {
			        var arr = toBase(n, base);
			        return (arr.isNegative ? "-" : "") + arr.value.map(function (x) {
			            return stringify(x, alphabet);
			        }).join('');
			    }

			    BigInteger.prototype.toArray = function (radix) {
			        return toBase(this, radix);
			    };

			    SmallInteger.prototype.toArray = function (radix) {
			        return toBase(this, radix);
			    };

			    NativeBigInt.prototype.toArray = function (radix) {
			        return toBase(this, radix);
			    };

			    BigInteger.prototype.toString = function (radix, alphabet) {
			        if (radix === undefined$1) radix = 10;
			        if (radix !== 10 || alphabet) return toBaseString(this, radix, alphabet);
			        var v = this.value, l = v.length, str = String(v[--l]), zeros = "0000000", digit;
			        while (--l >= 0) {
			            digit = String(v[l]);
			            str += zeros.slice(digit.length) + digit;
			        }
			        var sign = this.sign ? "-" : "";
			        return sign + str;
			    };

			    SmallInteger.prototype.toString = function (radix, alphabet) {
			        if (radix === undefined$1) radix = 10;
			        if (radix != 10 || alphabet) return toBaseString(this, radix, alphabet);
			        return String(this.value);
			    };

			    NativeBigInt.prototype.toString = SmallInteger.prototype.toString;

			    NativeBigInt.prototype.toJSON = BigInteger.prototype.toJSON = SmallInteger.prototype.toJSON = function () { return this.toString(); };

			    BigInteger.prototype.valueOf = function () {
			        return parseInt(this.toString(), 10);
			    };
			    BigInteger.prototype.toJSNumber = BigInteger.prototype.valueOf;

			    SmallInteger.prototype.valueOf = function () {
			        return this.value;
			    };
			    SmallInteger.prototype.toJSNumber = SmallInteger.prototype.valueOf;
			    NativeBigInt.prototype.valueOf = NativeBigInt.prototype.toJSNumber = function () {
			        return parseInt(this.toString(), 10);
			    };

			    function parseStringValue(v) {
			        if (isPrecise(+v)) {
			            var x = +v;
			            if (x === truncate(x))
			                return supportsNativeBigInt ? new NativeBigInt(BigInt(x)) : new SmallInteger(x);
			            throw new Error("Invalid integer: " + v);
			        }
			        var sign = v[0] === "-";
			        if (sign) v = v.slice(1);
			        var split = v.split(/e/i);
			        if (split.length > 2) throw new Error("Invalid integer: " + split.join("e"));
			        if (split.length === 2) {
			            var exp = split[1];
			            if (exp[0] === "+") exp = exp.slice(1);
			            exp = +exp;
			            if (exp !== truncate(exp) || !isPrecise(exp)) throw new Error("Invalid integer: " + exp + " is not a valid exponent.");
			            var text = split[0];
			            var decimalPlace = text.indexOf(".");
			            if (decimalPlace >= 0) {
			                exp -= text.length - decimalPlace - 1;
			                text = text.slice(0, decimalPlace) + text.slice(decimalPlace + 1);
			            }
			            if (exp < 0) throw new Error("Cannot include negative exponent part for integers");
			            text += (new Array(exp + 1)).join("0");
			            v = text;
			        }
			        var isValid = /^([0-9][0-9]*)$/.test(v);
			        if (!isValid) throw new Error("Invalid integer: " + v);
			        if (supportsNativeBigInt) {
			            return new NativeBigInt(BigInt(sign ? "-" + v : v));
			        }
			        var r = [], max = v.length, l = LOG_BASE, min = max - l;
			        while (max > 0) {
			            r.push(+v.slice(min, max));
			            min -= l;
			            if (min < 0) min = 0;
			            max -= l;
			        }
			        trim(r);
			        return new BigInteger(r, sign);
			    }

			    function parseNumberValue(v) {
			        if (supportsNativeBigInt) {
			            return new NativeBigInt(BigInt(v));
			        }
			        if (isPrecise(v)) {
			            if (v !== truncate(v)) throw new Error(v + " is not an integer.");
			            return new SmallInteger(v);
			        }
			        return parseStringValue(v.toString());
			    }

			    function parseValue(v) {
			        if (typeof v === "number") {
			            return parseNumberValue(v);
			        }
			        if (typeof v === "string") {
			            return parseStringValue(v);
			        }
			        if (typeof v === "bigint") {
			            return new NativeBigInt(v);
			        }
			        return v;
			    }
			    // Pre-define numbers in range [-999,999]
			    for (var i = 0; i < 1000; i++) {
			        Integer[i] = parseValue(i);
			        if (i > 0) Integer[-i] = parseValue(-i);
			    }
			    // Backwards compatibility
			    Integer.one = Integer[1];
			    Integer.zero = Integer[0];
			    Integer.minusOne = Integer[-1];
			    Integer.max = max;
			    Integer.min = min;
			    Integer.gcd = gcd;
			    Integer.lcm = lcm;
			    Integer.isInstance = function (x) { return x instanceof BigInteger || x instanceof SmallInteger || x instanceof NativeBigInt; };
			    Integer.randBetween = randBetween;

			    Integer.fromArray = function (digits, base, isNegative) {
			        return parseBaseFromArray(digits.map(parseValue), parseValue(base || 10), isNegative);
			    };

			    return Integer;
			})();

			// Node.js check
			if (module.hasOwnProperty("exports")) {
			    module.exports = bigInt;
			}
		} (BigInteger));
		return BigInteger.exports;
	}

	var hasRequiredSqlite;

	function requireSqlite () {
		if (hasRequiredSqlite) return sqlite;
		hasRequiredSqlite = 1;
		(function (exports) {
			!function(r,t){for(var e in t)r[e]=t[e];}(exports,function(r){var t={};function e(n){if(t[n])return t[n].exports;var o=t[n]={i:n,l:false,exports:{}};return r[n].call(o.exports,o,o.exports,e),o.l=true,o.exports}return e.m=r,e.c=t,e.d=function(r,t,n){e.o(r,t)||Object.defineProperty(r,t,{enumerable:true,get:n});},e.r=function(r){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(r,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(r,"__esModule",{value:true});},e.t=function(r,t){if(1&t&&(r=e(r)),8&t)return r;if(4&t&&"object"==typeof r&&r&&r.__esModule)return r;var n=Object.create(null);if(e.r(n),Object.defineProperty(n,"default",{enumerable:true,value:r}),2&t&&"string"!=typeof r)for(var o in r)e.d(n,o,function(t){return r[t]}.bind(null,o));return n},e.n=function(r){var t=r&&r.__esModule?function(){return r.default}:function(){return r};return e.d(t,"a",t),t},e.o=function(r,t){return Object.prototype.hasOwnProperty.call(r,t)},e.p="",e(e.s=1)}([function(r,t,e){var n=e(2);function o(r,t,e,n){this.message=r,this.expected=t,this.found=e,this.location=n,this.name="SyntaxError","function"==typeof Error.captureStackTrace&&Error.captureStackTrace(this,o);}!function(r,t){function e(){this.constructor=r;}e.prototype=t.prototype,r.prototype=new e;}(o,Error),o.buildMessage=function(r,t){var e={literal:function(r){return '"'+o(r.text)+'"'},class:function(r){var t,e="";for(t=0;t<r.parts.length;t++)e+=r.parts[t]instanceof Array?u(r.parts[t][0])+"-"+u(r.parts[t][1]):u(r.parts[t]);return "["+(r.inverted?"^":"")+e+"]"},any:function(r){return "any character"},end:function(r){return "end of input"},other:function(r){return r.description}};function n(r){return r.charCodeAt(0).toString(16).toUpperCase()}function o(r){return r.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\0/g,"\\0").replace(/\t/g,"\\t").replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/[\x00-\x0F]/g,(function(r){return "\\x0"+n(r)})).replace(/[\x10-\x1F\x7F-\x9F]/g,(function(r){return "\\x"+n(r)}))}function u(r){return r.replace(/\\/g,"\\\\").replace(/\]/g,"\\]").replace(/\^/g,"\\^").replace(/-/g,"\\-").replace(/\0/g,"\\0").replace(/\t/g,"\\t").replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/[\x00-\x0F]/g,(function(r){return "\\x0"+n(r)})).replace(/[\x10-\x1F\x7F-\x9F]/g,(function(r){return "\\x"+n(r)}))}return "Expected "+function(r){var t,n,o,u=new Array(r.length);for(t=0;t<r.length;t++)u[t]=(o=r[t],e[o.type](o));if(u.sort(),u.length>0){for(t=1,n=1;t<u.length;t++)u[t-1]!==u[t]&&(u[n]=u[t],n++);u.length=n;}switch(u.length){case 1:return u[0];case 2:return u[0]+" or "+u[1];default:return u.slice(0,-1).join(", ")+", or "+u[u.length-1]}}(r)+" but "+function(r){return r?'"'+o(r)+'"':"end of input"}(t)+" found."},r.exports={SyntaxError:o,parse:function(r,t){t=void 0!==t?t:{};var e,u={},a={start:Qu},s=Qu,i=function(r,t){return Zc(r,t,1)},c=Bu("IF",true),l=Bu("if",true),f=Bu("exists",true),p=Bu("TRIGGER",true),b=Bu("BEFORE",true),v=Bu("AFTER",true),y=Bu("INSTEAD OF",true),d=Bu("ON",true),h=Bu("OF",true),m=function(r,t){return Zc(r,t)},w=Bu("BEGIN",true),L=Bu("END",true),C=Bu("FOR",true),A=Bu("EACH",true),E=Bu("ROW",true),g=Bu("STATEMENT",true),j=(Bu("LOCAL",true)),_=Bu("CHECK",true),T=(function(r,t){return Zc(r,t)}),S=Bu("AUTO_INCREMENT",true),x=Bu("AUTOINCREMENT",true),k=Bu("UNIQUE",true),I=Bu("KEY",true),N=Bu("PRIMARY",true),O=Bu("COLUMN_FORMAT",true),R=Bu("FIXED",true),U=Bu("DYNAMIC",true),M=Bu("DEFAULT",true),D=Bu("STORAGE",true),P=Bu("DISK",true),F=Bu("MEMORY",true),$=Bu("GENERATED",true),H=Bu("ALWAYS",true),B=Bu("AS",true),G=Bu("STORED",true),q=Bu("VIRTUAL",true),W=Bu("first",true),Y=Bu("after",true),V=Bu("FOREIGN",true),Q=Bu("CHANGE",true),X=Bu("ALGORITHM",true),K=Bu("INSTANT",true),z=Bu("INPLACE",true),Z=Bu("COPY",true),J=Bu("LOCK",true),rr=Bu("NONE",true),tr=Bu("SHARED",true),er=Bu("EXCLUSIVE",true),nr=Bu("NOT",true),or=Bu("REPLICATION",true),ur=Bu("FOREIGN KEY",true),ar=Bu("ENFORCED",true),sr=Bu("MATCH FULL",true),ir=Bu("MATCH PARTIAL",true),cr=Bu("MATCH SIMPLE",true),lr=Bu("RESTRICT",true),fr=Bu("CASCADE",true),pr=Bu("SET NULL",true),br=Bu("NO ACTION",true),vr=Bu("SET DEFAULT",true),yr=Bu("CHARACTER",true),dr=Bu("SET",true),hr=Bu("CHARSET",true),mr=Bu("COLLATE",true),wr=Bu("AVG_ROW_LENGTH",true),Lr=Bu("KEY_BLOCK_SIZE",true),Cr=Bu("MAX_ROWS",true),Ar=Bu("MIN_ROWS",true),Er=Bu("STATS_SAMPLE_PAGES",true),gr=Bu("CONNECTION",true),jr=Bu("COMPRESSION",true),_r=Bu("'",false),Tr=Bu("ZLIB",true),Sr=Bu("LZ4",true),xr=Bu("ENGINE",true),kr=Bu("WITHOUT",true),Ir=Bu("ROWID",true),Nr=Bu("STRICT",true),Or=Bu("READ",true),Rr=Bu("LOW_PRIORITY",true),Ur=Bu("WRITE",true),Mr=function(r,t){return Zc(r,t)},Dr=Bu("BINARY",true),Pr=Bu("MASTER",true),Fr=Bu("LOGS",true),$r=Bu("BINLOG",true),Hr=Bu("EVENTS",true),Br=Bu("COLLATION",true),Gr=Bu("GRANTS",true),qr=Bu("(",false),Wr=Bu(")",false),Yr=Bu("BTREE",true),Vr=Bu("HASH",true),Qr=Bu("WITH",true),Xr=Bu("PARSER",true),Kr=Bu("VISIBLE",true),zr=Bu("INVISIBLE",true),Zr=function(r,t){return t.unshift(r),t.forEach(r=>{const{table:t,as:e}=r;ul[t]=t,e&&(ul[e]=t),function(r){const t=tl(r);r.clear(),t.forEach(t=>r.add(t));}(ol);}),t},Jr=Bu("=",false),rt=Bu("DUPLICATE",true),tt=Bu("ABORT",true),et=Bu("FAIL",true),nt=Bu("IGNORE",true),ot=Bu("REPLACE",true),ut=Bu("ROLLBACK",true),at=function(r,t){return Jc(r,t)},st=Bu("!",false),it=function(r){return r[0]+" "+r[2]},ct=Bu(">=",false),lt=Bu(">",false),ft=Bu("<=",false),pt=Bu("<>",false),bt=Bu("<",false),vt=Bu("==",false),yt=Bu("!=",false),dt=Bu("ESCAPE",true),ht=Bu("glob",true),mt=Bu("+",false),wt=Bu("-",false),Lt=Bu("*",false),Ct=Bu("/",false),At=Bu("%",false),Et=Bu("||",false),gt=Bu("&",false),jt=Bu(">>",false),_t=Bu("<<",false),Tt=Bu("^",false),St=Bu("|",false),xt=Bu("?",false),kt=Bu("~",false),It=Bu("?|",false),Nt=Bu("?&",false),Ot=Bu("#-",false),Rt=Bu("#>>",false),Ut=Bu("#>",false),Mt=Bu("@>",false),Dt=Bu("<@",false),Pt=function(r){return  true===Vc[r.toUpperCase()]},Ft=Bu('"',false),$t=/^[^"]/,Ht=Gu(['"'],true,false),Bt=/^[^']/,Gt=Gu(["'"],true,false),qt=Bu("`",false),Wt=/^[^`]/,Yt=Gu(["`"],true,false),Vt=function(r,t){return r+t.join("")},Qt=/^[A-Za-z_]/,Xt=Gu([["A","Z"],["a","z"],"_"],false,false),Kt=/^[A-Za-z0-9_]/,zt=Gu([["A","Z"],["a","z"],["0","9"],"_"],false,false),Zt=/^[A-Za-z0-9_:\u4E00-\u9FA5\xC0-\u017F]/,Jt=Gu([["A","Z"],["a","z"],["0","9"],"_",":",["一","龥"],["À","ſ"]],false,false),re=Bu(":",false),te=Bu("_binary",true),ee=Bu("X",true),ne=/^[0-9A-Fa-f]/,oe=Gu([["0","9"],["A","F"],["a","f"]],false,false),ue=Bu("b",true),ae=Bu("0x",false),se=function(r,t){return {type:r.toLowerCase(),value:t[1].join("")}},ie=/^[^"\\\0-\x1F\x7F]/,ce=Gu(['"',"\\",["\0",""],""],true,false),le=/^[^'\\]/,fe=Gu(["'","\\"],true,false),pe=Bu("\\'",false),be=Bu('\\"',false),ve=Bu("\\\\",false),ye=Bu("\\/",false),de=Bu("\\b",false),he=Bu("\\f",false),me=Bu("\\n",false),we=Bu("\\r",false),Le=Bu("\\t",false),Ce=Bu("\\u",false),Ae=Bu("\\",false),Ee=Bu("''",false),ge=Bu('""',false),je=Bu("``",false),_e=/^[\n\r]/,Te=Gu(["\n","\r"],false,false),Se=Bu(".",false),xe=/^[0-9]/,ke=Gu([["0","9"]],false,false),Ie=/^[0-9a-fA-F]/,Ne=Gu([["0","9"],["a","f"],["A","F"]],false,false),Oe=/^[eE]/,Re=Gu(["e","E"],false,false),Ue=/^[+\-]/,Me=Gu(["+","-"],false,false),De=Bu("ANALYZE",true),Pe=Bu("ATTACH",true),Fe=Bu("NULL",true),$e=Bu("NOT NULL",true),He=Bu("TRUE",true),Be=Bu("TO",true),Ge=Bu("FALSE",true),qe=Bu("SHOW",true),We=Bu("DROP",true),Ye=Bu("USE",true),Ve=Bu("ALTER",true),Qe=Bu("SELECT",true),Xe=Bu("UPDATE",true),Ke=Bu("CREATE",true),ze=Bu("TEMPORARY",true),Ze=Bu("TEMP",true),Je=Bu("DELETE",true),rn=Bu("INSERT",true),tn=Bu("RECURSIVE",true),en=Bu("RENAME",true),nn=Bu("RETURNING",true),on=(Bu("PARTITION",true)),un=Bu("INTO",true),an=Bu("FROM",true),sn=Bu("UNLOCK",true),cn=Bu("TABLE",true),ln=Bu("TABLES",true),fn=Bu("DATABASE",true),pn=Bu("SCHEMA",true),bn=Bu("LEFT",true),vn=Bu("INNER",true),yn=Bu("JOIN",true),dn=Bu("OUTER",true),hn=Bu("OVER",true),mn=Bu("UNION",true),wn=Bu("VALUES",true),Ln=Bu("USING",true),Cn=Bu("WHERE",true),An=Bu("GROUP",true),En=Bu("BY",true),gn=Bu("ORDER",true),jn=Bu("HAVING",true),_n=Bu("LIMIT",true),Tn=Bu("OFFSET",true),Sn=Bu("ASC",true),xn=Bu("DESC",true),kn=Bu("DESCRIBE",true),In=Bu("ALL",true),Nn=Bu("DISTINCT",true),On=Bu("BETWEEN",true),Rn=Bu("IN",true),Un=Bu("IS",true),Mn=Bu("LIKE",true),Dn=Bu("RLIKE",true),Pn=Bu("REGEXP",true),Fn=Bu("EXISTS",true),$n=Bu("AND",true),Hn=Bu("OR",true),Bn=Bu("COUNT",true),Gn=Bu("GROUP_CONCAT",true),qn=Bu("MAX",true),Wn=Bu("MIN",true),Yn=Bu("SUM",true),Vn=Bu("AVG",true),Qn=Bu("CALL",true),Xn=Bu("CASE",true),Kn=Bu("WHEN",true),zn=Bu("THEN",true),Zn=Bu("ELSE",true),Jn=Bu("CAST",true),ro=Bu("BIT",true),to=Bu("CHAR",true),eo=Bu("VARCHAR",true),no=Bu("NUMERIC",true),oo=Bu("DECIMAL",true),uo=Bu("SIGNED",true),ao=Bu("UNSIGNED",true),so=Bu("INT",true),io=Bu("ZEROFILL",true),co=Bu("INTEGER",true),lo=Bu("JSON",true),fo=Bu("SMALLINT",true),po=Bu("TINYINT",true),bo=Bu("TINYTEXT",true),vo=Bu("TEXT",true),yo=Bu("MEDIUMTEXT",true),ho=Bu("LONGTEXT",true),mo=Bu("BIGINT",true),wo=Bu("ENUM",true),Lo=Bu("FLOAT",true),Co=Bu("DOUBLE",true),Ao=Bu("REAL",true),Eo=Bu("DATE",true),go=Bu("DATETIME",true),jo=Bu("TIME",true),_o=Bu("TIMESTAMP",true),To=Bu("TRUNCATE",true),So=Bu("USER",true),xo=Bu("CURRENT_DATE",true),ko=(Bu("INTERVAL",true)),Io=Bu("YEAR",true),No=Bu("MONTH",true),Oo=Bu("DAY",true),Ro=Bu("HOUR",true),Uo=Bu("MINUTE",true),Mo=Bu("SECOND",true),Do=Bu("CURRENT_TIME",true),Po=Bu("CURRENT_TIMESTAMP",true),Fo=Bu("CURRENT_USER",true),$o=Bu("SESSION_USER",true),Ho=Bu("SYSTEM_USER",true),Bo=Bu("GLOBAL",true),Go=Bu("SESSION",true),qo=Bu("PERSIST",true),Wo=Bu("PERSIST_ONLY",true),Yo=Bu("VIEW",true),Vo=Bu("@",false),Qo=Bu("@@",false),Xo=Bu("$",false),Ko=Bu("return",true),zo=Bu(":=",false),Zo=Bu("DUAL",true),Jo=Bu("ADD",true),ru=Bu("COLUMN",true),tu=Bu("INDEX",true),eu=Bu("MODIFY",true),nu=Bu("FULLTEXT",true),ou=Bu("SPATIAL",true),uu=Bu("COMMENT",true),au=Bu("CONSTRAINT",true),su=Bu("REFERENCES",true),iu=Bu("SQL_CALC_FOUND_ROWS",true),cu=Bu("SQL_CACHE",true),lu=Bu("SQL_NO_CACHE",true),fu=Bu("SQL_SMALL_RESULT",true),pu=Bu("SQL_BIG_RESULT",true),bu=Bu("SQL_BUFFER_RESULT",true),vu=Bu(",",false),yu=Bu("[",false),du=Bu("]",false),hu=Bu(";",false),mu=Bu("->",false),wu=Bu("->>",false),Lu=Bu("&&",false),Cu=Bu("/*",false),Au=Bu("*/",false),Eu=Bu("--",false),gu=Bu("#",false),ju={type:"any"},_u=/^[ \t\n\r]/,Tu=Gu([" ","\t","\n","\r"],false,false),Su=Bu("blob",true),xu=Bu("tinyblob",true),ku=Bu("mediumblob",true),Iu=Bu("longblob",true),Nu=Bu("boolean",true),Ou=function(r){return {dataType:r}},Ru=/^[0-6]/,Uu=Gu([["0","6"]],false,false),Mu=0,Du=0,Pu=[{line:1,column:1}],Fu=0,$u=[],Hu=0;if("startRule"in t){if(!(t.startRule in a))throw new Error("Can't start parsing from rule \""+t.startRule+'".');s=a[t.startRule];}function Bu(r,t){return {type:"literal",text:r,ignoreCase:t}}function Gu(r,t,e){return {type:"class",parts:r,inverted:t,ignoreCase:e}}function qu(t){var e,n=Pu[t];if(n)return n;for(e=t-1;!Pu[e];)e--;for(n={line:(n=Pu[e]).line,column:n.column};e<t;)10===r.charCodeAt(e)?(n.line++,n.column=1):n.column++,e++;return Pu[t]=n,n}function Wu(r,t){var e=qu(r),n=qu(t);return {start:{offset:r,line:e.line,column:e.column},end:{offset:t,line:n.line,column:n.column}}}function Yu(r){Mu<Fu||(Mu>Fu&&(Fu=Mu,$u=[]),$u.push(r));}function Vu(r,t,e){return new o(o.buildMessage(r,t),r,t,e)}function Qu(){var r,t;return r=Mu,Tc()!==u&&(t=zu())!==u?(Du=r,r=t):(Mu=r,r=u),r}function Xu(){var t;return (t=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;t=Mu,"analyze"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(De));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ANALYZE"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&(n=Fa())!==u&&Tc()!==u?(Du=t,o=e,a=n,nl.add(`${o}::${a.db}::${a.table}`),e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:o.toLowerCase(),table:a}},t=e):(Mu=t,t=u);var o,a;return t}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=function(){var t,e,n,o;t=Mu,"attach"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Pe));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ATTACH"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&(n=Li())!==u&&Tc()!==u&&(o=is())!==u&&Tc()!==u&&(a=hi())!==u&&Tc()!==u&&(s=_s())!==u&&Tc()!==u?(Du=t,i=e,c=n,l=o,f=a,p=s,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:i.toLowerCase(),database:c,expr:l,as:f&&f[0].toLowerCase(),schema:p}},t=e):(Mu=t,t=u);var i,c,l,f,p;return t}())===u&&(t=function(){var r,t,e,n,o,a,s;r=Mu,(t=ai())!==u&&Tc()!==u&&(e=mi())!==u&&Tc()!==u?((n=ta())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ua())!==u?(Du=r,c=t,l=e,f=n,(p=o)&&p.forEach(r=>nl.add(`${c}::${r.db}::${r.table}`)),t={tableList:Array.from(nl),columnList:tl(ol),ast:{type:c.toLowerCase(),keyword:l.toLowerCase(),prefix:f,name:p}},r=t):(Mu=r,r=u)):(Mu=r,r=u);var c,l,f,p;r===u&&(r=Mu,(t=ai())!==u&&Tc()!==u&&(e=sc())!==u&&Tc()!==u?((n=ta())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ua())!==u?(Du=r,t=function(r,t,e,n){return {tableList:Array.from(nl),columnList:tl(ol),ast:{type:r.toLowerCase(),keyword:t.toLowerCase(),prefix:e,name:n}}}(t,e,n,o),r=t):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=ai())!==u&&Tc()!==u&&(e=bc())!==u&&Tc()!==u&&(n=Es())!==u&&Tc()!==u&&(o=Ci())!==u&&Tc()!==u&&(a=Fa())!==u&&Tc()!==u?((s=function(){var r,t,e,n,o,a;r=Mu,(t=la())===u&&(t=fa());if(t!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=la())===u&&(a=fa()),a!==u?n=o=[o,a]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=la())===u&&(a=fa()),a!==u?n=o=[o,a]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,t=i(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())===u&&(s=null),s!==u&&Tc()!==u?(Du=r,t=function(r,t,e,n,o){return {tableList:Array.from(nl),columnList:tl(ol),ast:{type:r.toLowerCase(),keyword:t.toLowerCase(),name:e,table:n,options:o}}}(t,e,n,a,s),r=t):(Mu=r,r=u)):(Mu=r,r=u)));return r}())===u&&(t=function(){var t;(t=function(){var r,t,e,n,o,a,s;r=Mu,(t=ii())!==u&&Tc()!==u?((e=ci())===u&&(e=li()),e===u&&(e=null),e!==u&&Tc()!==u&&mi()!==u&&Tc()!==u?((n=ra())===u&&(n=null),n!==u&&Tc()!==u&&(o=Fa())!==u&&Tc()!==u&&(a=function(){var r,t,e,n,o,a,s,i,c;if(r=Mu,(t=Cc())!==u)if(Tc()!==u)if((e=oa())!==u){for(n=[],o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=oa())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=oa())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);n!==u&&(o=Tc())!==u&&(a=Ac())!==u?(Du=r,t=T(e,n),r=t):(Mu=r,r=u);}else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;return r}())!==u&&Tc()!==u?((s=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=wa())!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=wc())===u&&(a=null),a!==u&&(s=Tc())!==u&&(i=wa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=wc())===u&&(a=null),a!==u&&(s=Tc())!==u&&(i=wa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,t=m(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())===u&&(s=null),s!==u?(Du=r,i=t,c=e,l=n,p=a,b=s,(f=o)&&nl.add(`create::${f.db}::${f.table}`),t={tableList:Array.from(nl),columnList:tl(ol),ast:{type:i[0].toLowerCase(),keyword:"table",temporary:c&&c[0].toLowerCase(),if_not_exists:l,table:[f],create_definitions:p,table_options:b}},r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);var i,c,l,f,p,b;r===u&&(r=Mu,(t=ii())!==u&&Tc()!==u?((e=ci())===u&&(e=li()),e===u&&(e=null),e!==u&&Tc()!==u&&mi()!==u&&Tc()!==u?((n=ra())===u&&(n=null),n!==u&&Tc()!==u&&(o=Fa())!==u&&Tc()!==u&&(a=hi())!==u&&Tc()!==u&&(s=Ca())!==u?(Du=r,t=function(r,t,e,n,o,u){return n&&nl.add(`create::${n.db}::${n.table}`),{tableList:Array.from(nl),columnList:tl(ol),ast:{type:r[0].toLowerCase(),keyword:"table",temporary:t&&t[0].toLowerCase(),if_not_exists:e,table:[n],as:"as",query_expr:u}}}(t,e,n,o,0,s),r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u));return r}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=ii())!==u&&Tc()!==u?((n=Li())===u&&(n=function(){var t,e,n,o;t=Mu,"schema"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(pn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SCHEMA"):(Mu=t,t=u)):(Mu=t,t=u);return t}()),n!==u&&Tc()!==u?((o=ra())===u&&(o=null),o!==u&&Tc()!==u&&(a=$c())!==u&&Tc()!==u?((s=function(){var r,t,e,n,o,a;if(r=Mu,(t=ma())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=ma())!==u?n=o=[o,a]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=ma())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u?(Du=r,t=i(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())===u&&(s=null),s!==u?(Du=t,e=function(r,t,e,n,o){const u=t.toLowerCase();return {tableList:Array.from(nl),columnList:tl(ol),ast:{type:r[0].toLowerCase(),keyword:u,if_not_exists:e,[u]:{db:n.schema,schema:n.name},create_definitions:o}}}(e,n,o,a,s),t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var r,t,e,n,o,a,s,i,c,l,f;r=Mu,(t=ii())!==u&&Tc()!==u?((e=yc())===u&&(e=null),e!==u&&Tc()!==u&&(n=bc())!==u&&Tc()!==u?((o=ra())===u&&(o=null),o!==u&&Tc()!==u&&(a=Fa())!==u&&Tc()!==u?((s=Na())===u&&(s=null),s!==u&&Tc()!==u&&(i=Ci())!==u&&Tc()!==u&&(c=Fa())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(l=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=na())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=na())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=na())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=m(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((f=Ba())===u&&(f=null),f!==u?(Du=r,p=t,b=e,v=n,y=o,d=a,h=i,w=c,L=l,C=f,t={tableList:Array.from(nl),columnList:tl(ol),ast:{type:p[0].toLowerCase(),index_type:b&&b.toLowerCase(),keyword:v.toLowerCase(),if_not_exists:y,index:{schema:d.db,name:d.table},on_kw:h[0].toLowerCase(),table:w,index_columns:L,where:C}},r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);var p,b,v,y,d,h,w,L,C;return r}())===u&&(t=function(){var t,e,n,o,a,s,i,c,l,f,h,j,_;t=Mu,(e=ii())!==u&&Tc()!==u?((n=ci())===u&&(n=li()),n===u&&(n=null),n!==u&&Tc()!==u?("trigger"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(p)),o!==u&&Tc()!==u?((a=ra())===u&&(a=null),a!==u&&Tc()!==u&&(s=Fa())!==u&&Tc()!==u?("before"===r.substr(Mu,6).toLowerCase()?(i=r.substr(Mu,6),Mu+=6):(i=u,0===Hu&&Yu(b)),i===u&&("after"===r.substr(Mu,5).toLowerCase()?(i=r.substr(Mu,5),Mu+=5):(i=u,0===Hu&&Yu(v)),i===u&&("instead of"===r.substr(Mu,10).toLowerCase()?(i=r.substr(Mu,10),Mu+=10):(i=u,0===Hu&&Yu(y)))),i===u&&(i=null),i!==u&&Tc()!==u&&(c=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=ea())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=Pi())!==u&&(s=Tc())!==u&&(i=ea())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Pi())!==u&&(s=Tc())!==u&&(i=ea())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=m(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u&&Tc()!==u?("on"===r.substr(Mu,2).toLowerCase()?(l=r.substr(Mu,2),Mu+=2):(l=u,0===Hu&&Yu(d)),l!==u&&Tc()!==u&&(f=Fa())!==u&&Tc()!==u?((h=function(){var t,e,n,o;t=Mu,"for"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(C));e!==u&&Tc()!==u?("each"===r.substr(Mu,4).toLowerCase()?(n=r.substr(Mu,4),Mu+=4):(n=u,0===Hu&&Yu(A)),n===u&&(n=null),n!==u&&Tc()!==u?("row"===r.substr(Mu,3).toLowerCase()?(o=r.substr(Mu,3),Mu+=3):(o=u,0===Hu&&Yu(E)),o===u&&("statement"===r.substr(Mu,9).toLowerCase()?(o=r.substr(Mu,9),Mu+=9):(o=u,0===Hu&&Yu(g))),o!==u?(Du=t,a=e,i=o,e={keyword:(s=n)?`${a.toLowerCase()} ${s.toLowerCase()}`:a.toLowerCase(),args:i.toLowerCase()},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var a,s,i;return t}())===u&&(h=null),h!==u&&Tc()!==u?((j=function(){var r,t;r=Mu,$i()!==u&&Tc()!==u&&(t=is())!==u?(Du=r,r={type:"when",cond:t}):(Mu=r,r=u);return r}())===u&&(j=null),j!==u&&Tc()!==u&&(_=function(){var t,e,n,o;t=Mu,"begin"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(w));e!==u&&Tc()!==u&&(n=zu())!==u&&Tc()!==u?("end"===r.substr(Mu,3).toLowerCase()?(o=r.substr(Mu,3),Mu+=3):(o=u,0===Hu&&Yu(L)),o!==u?(Du=t,t=e={type:"multiple",prefix:e,expr:n,suffix:o}):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u?(Du=t,S=o,x=a,k=s,I=i,N=c,O=f,R=h,U=j,M=_,e={type:"create",temporary:(T=n)&&T[0].toLowerCase(),time:I&&I.toLowerCase(),events:N,trigger:k,table:O,for_each:R,if_not_exists:x,when:U,execute:M,keyword:S&&S.toLowerCase()},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var T,S,x,k,I,N,O,R,U,M;return t}())===u&&(t=function(){var r,t,e,n,o,a,s,i,c,l,f;r=Mu,(t=ii())!==u&&Tc()!==u?((e=li())===u&&(e=ci()),e===u&&(e=null),e!==u&&Tc()!==u&&sc()!==u&&Tc()!==u?((n=ra())===u&&(n=null),n!==u&&Tc()!==u&&(o=Fa())!==u&&Tc()!==u?(a=Mu,(s=Cc())!==u&&(i=Tc())!==u&&(c=gs())!==u&&(l=Tc())!==u&&(f=Ac())!==u?a=s=[s,i,c,l,f]:(Mu=a,a=u),a===u&&(a=null),a!==u&&(s=Tc())!==u&&(i=hi())!==u&&(c=Tc())!==u&&(l=ja())!==u?(Du=r,p=t,b=e,v=n,d=a,h=l,(y=o).view=y.table,delete y.table,t={tableList:Array.from(nl),columnList:tl(ol),ast:{type:p[0].toLowerCase(),keyword:"view",if_not_exists:v,temporary:b&&b[0].toLowerCase(),columns:d&&d[2],select:h,view:y}},r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);var p,b,v,y,d,h;return r}());return t}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=function(){var t,e,n,o;t=Mu,"truncate"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(To));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TRUNCATE"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u?((n=mi())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ua())!==u?(Du=t,a=e,s=n,(i=o)&&i.forEach(r=>nl.add(`${a}::${r.db}::${r.table}`)),e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:a.toLowerCase(),keyword:s&&s.toLowerCase()||"table",name:i}},t=e):(Mu=t,t=u)):(Mu=t,t=u);var a,s,i;return t}())===u&&(t=function(){var r,t,e;r=Mu,(t=bi())!==u&&Tc()!==u&&mi()!==u&&Tc()!==u&&(e=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Ia())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Ia())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Ia())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=T(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=r,(n=e).forEach(r=>r.forEach(r=>r.table&&nl.add(`rename::${r.db}::${r.table}`))),t={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"rename",table:n}},r=t):(Mu=r,r=u);var n;return r}())===u&&(t=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;t=Mu,"call"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Qn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CALL"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&(n=Hc())!==u?(Du=t,o=n,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"call",expr:o}},t=e):(Mu=t,t=u);var o;return t}())===u&&(t=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;t=Mu,"use"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Ye));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&(n=_s())!==u?(Du=t,o=n,nl.add(`use::${o}::null`),e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"use",db:o}},t=e):(Mu=t,t=u);var o;return t}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=function(){var t,e,n,o;t=Mu,"alter"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Ve));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&mi()!==u&&Tc()!==u&&(n=Ua())!==u&&Tc()!==u&&(o=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=ca())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=ca())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=ca())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=T(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=t,s=o,(a=n)&&a.length>0&&a.forEach(r=>nl.add(`alter::${r.db}::${r.table}`)),e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"alter",table:a,expr:s}},t=e):(Mu=t,t=u);var a,s;return t}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=di())!==u&&Tc()!==u?((n=function(){var t,e,n,o;t=Mu,"global"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Bo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="GLOBAL"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=function(){var t,e,n,o;t=Mu,"session"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(Go));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SESSION"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=function(){var t,e,n,o;t=Mu,"local"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(j));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="LOCAL"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=function(){var t,e,n,o;t=Mu,"persist"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(qo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="PERSIST"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=function(){var t,e,n,o;t=Mu,"persist_only"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(Wo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="PERSIST_ONLY"):(Mu=t,t=u)):(Mu=t,t=u);return t}()),n===u&&(n=null),n!==u&&Tc()!==u&&(o=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Uc())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Uc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Uc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=Mr(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=t,a=n,(s=o).keyword=a,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"set",keyword:a,expr:s}},t=e):(Mu=t,t=u)):(Mu=t,t=u);var a,s;return t}())===u&&(t=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;t=Mu,"lock"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(J));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&wi()!==u&&Tc()!==u&&(n=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=La())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=La())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=La())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=Mr(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=t,o=n,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"lock",keyword:"tables",tables:o}},t=e):(Mu=t,t=u);var o;return t}())===u&&(t=function(){var t,e;t=Mu,(e=function(){var t,e,n,o;t=Mu,"unlock"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(sn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&wi()!==u?(Du=t,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"unlock",keyword:"tables"}},t=e):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o,a,s,i,c,l;t=Mu,(e=ui())!==u&&Tc()!==u?("binary"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(Dr)),n===u&&("master"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(Pr))),n!==u&&(o=Tc())!==u?("logs"===r.substr(Mu,4).toLowerCase()?(a=r.substr(Mu,4),Mu+=4):(a=u,0===Hu&&Yu(Fr)),a!==u?(Du=t,f=n,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"show",suffix:"logs",keyword:f.toLowerCase()}},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var f;t===u&&(t=Mu,(e=ui())!==u&&Tc()!==u?("binlog"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu($r)),n!==u&&(o=Tc())!==u?("events"===r.substr(Mu,6).toLowerCase()?(a=r.substr(Mu,6),Mu+=6):(a=u,0===Hu&&Yu(Hr)),a!==u&&(s=Tc())!==u?((i=ds())===u&&(i=null),i!==u&&Tc()!==u?((c=ka())===u&&(c=null),c!==u&&Tc()!==u?((l=Va())===u&&(l=null),l!==u?(Du=t,p=i,b=c,v=l,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"show",suffix:"events",keyword:"binlog",in:p,from:b,limit:v}},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=ui())!==u&&Tc()!==u?(n=Mu,"character"===r.substr(Mu,9).toLowerCase()?(o=r.substr(Mu,9),Mu+=9):(o=u,0===Hu&&Yu(yr)),o!==u&&(a=Tc())!==u?("set"===r.substr(Mu,3).toLowerCase()?(s=r.substr(Mu,3),Mu+=3):(s=u,0===Hu&&Yu(dr)),s!==u?n=o=[o,a,s]:(Mu=n,n=u)):(Mu=n,n=u),n===u&&("collation"===r.substr(Mu,9).toLowerCase()?(n=r.substr(Mu,9),Mu+=9):(n=u,0===Hu&&Yu(Br))),n!==u&&(o=Tc())!==u?((a=ys())===u&&(a=Ba()),a===u&&(a=null),a!==u?(Du=t,e=function(r,t){let e=Array.isArray(r)&&r||[r];return {tableList:Array.from(nl),columnList:tl(ol),ast:{type:"show",suffix:e[2]&&e[2].toLowerCase(),keyword:e[0].toLowerCase(),expr:t}}}(n,a),t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=function(){var t,e,n,o;t=Mu,(e=ui())!==u&&Tc()!==u?("grants"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(Gr)),n!==u&&Tc()!==u?((o=function(){var t,e,n,o,a,s,i;t=Mu,"for"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(C));e!==u&&Tc()!==u&&(n=_s())!==u&&Tc()!==u?(o=Mu,(a=ic())!==u&&(s=Tc())!==u&&(i=_s())!==u?o=a=[a,s,i]:(Mu=o,o=u),o===u&&(o=null),o!==u&&(a=Tc())!==u?((s=function(){var r,t;r=Mu,gi()!==u&&Tc()!==u&&(t=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=_s())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=_s())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=_s())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=Mr(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=r,r=t):(Mu=r,r=u);return r}())===u&&(s=null),s!==u?(Du=t,l=s,e={user:n,host:(c=o)&&c[2],role_list:l},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var c,l;return t}())===u&&(o=null),o!==u?(Du=t,a=o,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"show",keyword:"grants",for:a}},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var a;return t}())));var p,b,v;return t}())===u&&(t=function(){var t,e,n;t=Mu,(e=Si())===u&&(e=function(){var t,e,n,o;t=Mu,"describe"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(kn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DESCRIBE"):(Mu=t,t=u)):(Mu=t,t=u);return t}());e!==u&&Tc()!==u&&(n=_s())!==u?(Du=t,o=n,e={tableList:Array.from(nl),columnList:tl(ol),ast:{type:"desc",table:o}},t=e):(Mu=t,t=u);var o;return t}()),t}function Ku(){var t;return (t=Ju())===u&&(t=function(){var r,t,e,n,o,a,s,i;r=Mu,(t=si())!==u&&Tc()!==u&&(e=Ua())!==u&&Tc()!==u&&di()!==u&&Tc()!==u&&(n=Qa())!==u&&Tc()!==u?((o=Ba())===u&&(o=null),o!==u&&Tc()!==u?((a=Ka())===u&&(a=null),a!==u&&Tc()!==u?((s=qa())===u&&(s=null),s!==u&&Tc()!==u?((i=Va())===u&&(i=null),i!==u?(Du=r,t=function(r,t,e,n,o,u){const a={};return r&&r.forEach(r=>{const{server:t,db:e,schema:n,as:o,table:u,join:s}=r,i=s?"select":"update",c=[t,e,n].filter(Boolean).join(".")||null;e&&(a[u]=c),u&&nl.add(`${i}::${c}::${u}`);}),t&&t.forEach(r=>{if(r.table){const t=rl(r.table);nl.add(`update::${a[t]||null}::${t}`);}ol.add(`update::${r.table}::${r.column}`);}),{tableList:Array.from(nl),columnList:tl(ol),ast:{type:"update",table:r,set:t,where:e,returning:n,orderby:o,limit:u}}}(e,n,o,a,s,i),r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);return r}())===u&&(t=function(){var r,t,e,n,o,a,s,i,c;r=Mu,(t=rs())!==u&&Tc()!==u?((e=yi())===u&&(e=null),e!==u&&Tc()!==u&&(n=Fa())!==u&&Tc()!==u?((o=Za())===u&&(o=null),o!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(a=gs())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u&&(s=za())!==u&&Tc()!==u?((i=Ja())===u&&(i=null),i!==u&&Tc()!==u?((c=Ka())===u&&(c=null),c!==u?(Du=r,t=function(r,t,e,n,o,u,a){if(t&&(nl.add(`insert::${t.db}::${t.table}`),t.as=null),n){let r=t&&t.table||null;Array.isArray(o.values)&&o.values.forEach((r,t)=>{if(r.value.length!=n.length)throw new Error("Error: column count doesn't match value count at row "+(t+1))}),n.forEach(t=>ol.add(`insert::${r}::${t}`));}return {tableList:Array.from(nl),columnList:tl(ol),ast:{...r,table:[t],columns:n,values:o,partition:e,on_duplicate_update:u,returning:a}}}(t,n,o,a,s,i,c),r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);return r}())===u&&(t=function(){var t,e,n,o,a,s,i,c,l;t=Mu,(e=rs())!==u&&Tc()!==u?((n=function(){var t,e,n,o;t=Mu,"ignore"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(nt));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=null),n!==u&&Tc()!==u?((o=yi())===u&&(o=null),o!==u&&Tc()!==u&&(a=Fa())!==u&&Tc()!==u?((s=Za())===u&&(s=null),s!==u&&Tc()!==u&&(i=za())!==u&&Tc()!==u?((c=Ja())===u&&(c=null),c!==u&&Tc()!==u?((l=Ka())===u&&(l=null),l!==u?(Du=t,e=function(r,t,e,n,o,u,a,s){n&&(nl.add(`insert::${n.db}::${n.table}`),ol.add(`insert::${n.table}::(.*)`),n.as=null);const i=[t,e].filter(r=>r).map(r=>r[0]&&r[0].toLowerCase()).join(" ");return {tableList:Array.from(nl),columnList:tl(ol),ast:{...r,table:[n],columns:null,values:u,partition:o,prefix:i,on_duplicate_update:a,returning:s}}}(e,n,o,a,s,i,c,l),t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var r,t,e,n,o,a;r=Mu,(t=rs())!==u&&Tc()!==u&&yi()!==u&&Tc()!==u&&(e=Fa())!==u&&Tc()!==u?((n=Za())===u&&(n=null),n!==u&&Tc()!==u&&di()!==u&&Tc()!==u&&(o=Qa())!==u&&Tc()!==u?((a=Ja())===u&&(a=null),a!==u?(Du=r,s=t,c=n,l=o,f=a,(i=e)&&(nl.add(`insert::${i.db}::${i.table}`),ol.add(`insert::${i.table}::(.*)`),i.as=null),t={tableList:Array.from(nl),columnList:tl(ol),ast:{...s,table:[i],columns:null,partition:c,set:l,on_duplicate_update:f}},r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);var s,i,c,l,f;return r}())===u&&(t=function(){var r,t,e,n,o,a,s,i;r=Mu,(t=fi())!==u&&Tc()!==u?((e=Ua())===u&&(e=null),e!==u&&Tc()!==u&&(n=ka())!==u&&Tc()!==u?((o=Ba())===u&&(o=null),o!==u&&Tc()!==u?((a=Ka())===u&&(a=null),a!==u&&Tc()!==u?((s=qa())===u&&(s=null),s!==u&&Tc()!==u?((i=Va())===u&&(i=null),i!==u?(Du=r,t=function(r,t,e,n,o,u){if(t&&t.forEach(r=>{const{db:t,as:e,table:n,join:o}=r,u=o?"select":"delete";n&&nl.add(`${u}::${t}::${n}`),o||ol.add(`delete::${n}::(.*)`);}),null===r&&1===t.length){const e=t[0];r=[{db:e.db,table:e.table,as:e.as,addition:true}];}return {tableList:Array.from(nl),columnList:tl(ol),ast:{type:"delete",table:r,from:t,where:e,returning:n,orderby:o,limit:u}}}(e,n,o,a,s,i),r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);return r}())===u&&(t=Xu())===u&&(t=function(){var r,t;r=[],t=Rc();for(;t!==u;)r.push(t),t=Rc();return r}()),t}function zu(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Ku())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=Ec())!==u&&(s=Tc())!==u&&(i=Ku())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Ec())!==u&&(s=Tc())!==u&&(i=Ku())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){const e=r&&r.ast||r,n=t&&t.length&&t[0].length>=4?[e]:e;t||(t=[]);for(let r=0;r<t.length;r++)t[r][3]&&0!==t[r][3].length&&n.push(t[r][3]&&t[r][3].ast||t[r][3]);return {tableList:Array.from(nl),columnList:tl(ol),ast:n}}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Zu(){var t,e,n;return t=Mu,function(){var t,e,n,o;t=Mu,"union"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(mn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u?((e=xi())===u&&(e=ki()),e===u&&(e=null),e!==u?(Du=t,t=(n=e)?"union "+n.toLowerCase():"union"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ju(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Ca())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=Zu())!==u&&(s=Tc())!==u&&(i=Ca())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Zu())!==u&&(s=Tc())!==u&&(i=Ca())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u&&(n=Tc())!==u?((o=qa())===u&&(o=null),o!==u&&(a=Tc())!==u?((s=Va())===u&&(s=null),s!==u?(Du=r,r=t=function(r,t,e,n){let o=r;for(let r=0;r<t.length;r++)o._next=t[r][3],o.set_op=t[r][1],o=o._next;return e&&(r._orderby=e),n&&(r._limit=n),{tableList:Array.from(nl),columnList:tl(ol),ast:r}}(t,e,o,s)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);}else Mu=r,r=u;return r}function ra(){var t,e;return t=Mu,"if"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(c)),e!==u&&Tc()!==u&&Mi()!==u&&Tc()!==u&&Ui()!==u?(Du=t,t=e="IF NOT EXISTS"):(Mu=t,t=u),t}function ta(){var t,e,n;return t=Mu,"if"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(l)),e!==u&&Tc()!==u?("exists"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(f)),n!==u?(Du=t,t=e="if exists"):(Mu=t,t=u)):(Mu=t,t=u),t}function ea(){var t,e,n,o,a,s;return t=Mu,(e=pi())===u&&(e=fi()),e!==u&&(Du=t,e={keyword:e[0].toLowerCase()}),(t=e)===u&&(t=Mu,(e=si())!==u&&Tc()!==u?(n=Mu,"of"===r.substr(Mu,2).toLowerCase()?(o=r.substr(Mu,2),Mu+=2):(o=u,0===Hu&&Yu(h)),o!==u&&(a=Tc())!==u&&(s=Ga())!==u?n=o=[o,a,s]:(Mu=n,n=u),n===u&&(n=null),n!==u?(Du=t,t=e=function(r,t){return {keyword:r[0].toLowerCase(),args:t&&{keyword:t[0],columns:t[2]}||null}}(e,n)):(Mu=t,t=u)):(Mu=t,t=u)),t}function na(){var r,t,e,n,o,a;return r=Mu,(t=is())!==u&&Tc()!==u?((e=sa())===u&&(e=null),e!==u&&Tc()!==u?((n=Ti())===u&&(n=Si()),n===u&&(n=null),n!==u?(Du=r,o=t,a=n,r=t={collate:e,...o,order_by:a&&a.toLowerCase()}):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=function(){var r,t,e;r=Mu,(t=Es())!==u&&Tc()!==u?((e=Ti())===u&&(e=Si()),e===u&&(e=null),e!==u?(Du=r,t=function(r,t){return {...r,order_by:t&&t.toLowerCase()}}(t,e),r=t):(Mu=r,r=u)):(Mu=r,r=u);return r}()),r}function oa(){var t;return (t=ba())===u&&(t=aa())===u&&(t=pa())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=function(){var t,e,n,o;t=Mu,"fulltext"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(nu));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="FULLTEXT"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(e=function(){var t,e,n,o;t=Mu,"spatial"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(ou));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SPATIAL"):(Mu=t,t=u)):(Mu=t,t=u);return t}());e!==u&&Tc()!==u?((n=bc())===u&&(n=vc()),n===u&&(n=null),n!==u&&Tc()!==u?((o=Os())===u&&(o=null),o!==u&&Tc()!==u&&(a=ga())!==u&&Tc()!==u?((s=Oa())===u&&(s=null),s!==u&&Tc()!==u?(Du=t,i=e,l=s,e={index:o,definition:a,keyword:(c=n)&&`${i.toLowerCase()} ${c.toLowerCase()}`||i.toLowerCase(),index_options:l,resource:"index"},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var i,c,l;return t}()),t}function ua(){var t,e,n,o,a;return t=Mu,(e=function(){var t,e;t=Mu,(e=function(){var t,e,n,o;t=Mu,"not null"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu($e));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={type:"not null",value:"not null"});return t=e}())===u&&(e=Ws()),e!==u&&(Du=t,(a=e)&&!a.value&&(a.value="null"),e={nullable:a}),(t=e)===u&&(t=Mu,(e=function(){var r,t;r=Mu,ni()!==u&&Tc()!==u&&(t=is())!==u?(Du=r,r={type:"default",value:t}):(Mu=r,r=u);return r}())!==u&&(Du=t,e={default_val:e}),(t=e)===u&&(t=Mu,"auto_increment"===r.substr(Mu,14).toLowerCase()?(e=r.substr(Mu,14),Mu+=14):(e=u,0===Hu&&Yu(S)),e===u&&("autoincrement"===r.substr(Mu,13).toLowerCase()?(e=r.substr(Mu,13),Mu+=13):(e=u,0===Hu&&Yu(x))),e!==u&&(Du=t,e={auto_increment:e.toLowerCase()}),(t=e)===u&&(t=Mu,"unique"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(k)),e!==u&&Tc()!==u?("key"===r.substr(Mu,3).toLowerCase()?(n=r.substr(Mu,3),Mu+=3):(n=u,0===Hu&&Yu(I)),n===u&&(n=null),n!==u?(Du=t,t=e=function(r){const t=["unique"];return r&&t.push(r),{unique:t.join(" ").toLowerCase("")}}(n)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"primary"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(N)),e===u&&(e=null),e!==u&&Tc()!==u?("key"===r.substr(Mu,3).toLowerCase()?(n=r.substr(Mu,3),Mu+=3):(n=u,0===Hu&&Yu(I)),n!==u?(Du=t,t=e=function(r){const t=[];return r&&t.push("primary"),t.push("key"),{primary_key:t.join(" ").toLowerCase("")}}(e)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=kc())!==u&&(Du=t,e={comment:e}),(t=e)===u&&(t=Mu,(e=hc())!==u&&Tc()!==u&&(n=js())!==u?(Du=t,t=e=function(r,t){return {constraint:{keyword:r.toLowerCase(),constraint:t}}}(e,n)):(Mu=t,t=u),t===u&&(t=Mu,(e=sa())!==u&&(Du=t,e={collate:e}),(t=e)===u&&(t=Mu,(e=function(){var t,e,n;t=Mu,"column_format"===r.substr(Mu,13).toLowerCase()?(e=r.substr(Mu,13),Mu+=13):(e=u,0===Hu&&Yu(O));e!==u&&Tc()!==u?("fixed"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(R)),n===u&&("dynamic"===r.substr(Mu,7).toLowerCase()?(n=r.substr(Mu,7),Mu+=7):(n=u,0===Hu&&Yu(U)),n===u&&("default"===r.substr(Mu,7).toLowerCase()?(n=r.substr(Mu,7),Mu+=7):(n=u,0===Hu&&Yu(M)))),n!==u?(Du=t,e={type:"column_format",value:n.toLowerCase()},t=e):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={column_format:e}),(t=e)===u&&(t=Mu,(e=function(){var t,e,n;t=Mu,"storage"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(D));e!==u&&Tc()!==u?("disk"===r.substr(Mu,4).toLowerCase()?(n=r.substr(Mu,4),Mu+=4):(n=u,0===Hu&&Yu(P)),n===u&&("memory"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(F))),n!==u?(Du=t,e={type:"storage",value:n.toLowerCase()},t=e):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={storage:e}),(t=e)===u&&(t=Mu,(e=ya())!==u&&(Du=t,e={reference_definition:e}),(t=e)===u&&(t=Mu,(e=function(){var t,e,n,o,a,s,i,c;t=Mu,(e=va())===u&&(e=null);e!==u&&Tc()!==u?("check"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(_)),n!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(o=$a())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?(a=Mu,(s=Mi())===u&&(s=null),s!==u&&(i=Tc())!==u?("enforced"===r.substr(Mu,8).toLowerCase()?(c=r.substr(Mu,8),Mu+=8):(c=u,0===Hu&&Yu(ar)),c!==u?a=s=[s,i,c]:(Mu=a,a=u)):(Mu=a,a=u),a===u&&(a=null),a!==u?(Du=t,e=function(r,t,e,n){const o=[];return n&&o.push(n[0],n[2]),{constraint_type:t.toLowerCase(),keyword:r&&r.keyword,constraint:r&&r.constraint,definition:[e],enforced:o.filter(r=>r).join(" ").toLowerCase(),resource:"constraint"}}(e,n,o,a),t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={check:e}),(t=e)===u&&(t=Mu,(e=ha())!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u&&(o=js())!==u?(Du=t,t=e=function(r,t,e){return {character_set:{type:r,value:e,symbol:t}}}(e,n,o)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=function(){var t,e,n,o,a,s,i,c;t=Mu,e=Mu,(n=function(){var t,e,n,o,a;t=Mu,e=Mu,"generated"===r.substr(Mu,9).toLowerCase()?(n=r.substr(Mu,9),Mu+=9):(n=u,0===Hu&&Yu($));n!==u&&(o=Tc())!==u?("always"===r.substr(Mu,6).toLowerCase()?(a=r.substr(Mu,6),Mu+=6):(a=u,0===Hu&&Yu(H)),a!==u?e=n=[n,o,a]:(Mu=e,e=u)):(Mu=e,e=u);e!==u&&(Du=t,e=e.join("").toLowerCase());return t=e}())===u&&(n=null);n!==u&&(o=Tc())!==u?("as"===r.substr(Mu,2).toLowerCase()?(a=r.substr(Mu,2),Mu+=2):(a=u,0===Hu&&Yu(B)),a!==u?e=n=[n,o,a]:(Mu=e,e=u)):(Mu=e,e=u);if(e!==u)if((n=Tc())!==u)if((o=Cc())!==u)if((a=Tc())!==u)if((s=qs())===u&&(s=is()),s!==u)if(Tc()!==u)if(Ac()!==u)if(Tc()!==u){for(i=[],"stored"===r.substr(Mu,6).toLowerCase()?(c=r.substr(Mu,6),Mu+=6):(c=u,0===Hu&&Yu(G)),c===u&&("virtual"===r.substr(Mu,7).toLowerCase()?(c=r.substr(Mu,7),Mu+=7):(c=u,0===Hu&&Yu(q)));c!==u;)i.push(c),"stored"===r.substr(Mu,6).toLowerCase()?(c=r.substr(Mu,6),Mu+=6):(c=u,0===Hu&&Yu(G)),c===u&&("virtual"===r.substr(Mu,7).toLowerCase()?(c=r.substr(Mu,7),Mu+=7):(c=u,0===Hu&&Yu(q)));i!==u?(Du=t,l=i,e={type:"generated",expr:s,value:e.filter(r=>"string"==typeof r).join(" ").toLowerCase(),storage_type:l&&l[0]&&l[0].toLowerCase()},t=e):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;var l;return t}())!==u&&(Du=t,e={generated:e}),t=e))))))))))))),t}function aa(){var r,t,e,n,o,a,s;return r=Mu,(t=Ns())!==u&&Tc()!==u?((e=Wc())===u&&(e=null),e!==u&&Tc()!==u?((n=function(){var r,t,e,n,o,a;if(r=Mu,(t=ua())!==u)if(Tc()!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=ua())!==u?n=o=[o,a]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=ua())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){let e=r;for(let r=0;r<t.length;r++)e={...e,...t[r][1]};return e}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;else Mu=r,r=u;return r}())===u&&(n=null),n!==u?(Du=r,o=t,a=e,s=n,ol.add(`create::${o.table}::${o.value||o}`),r=t={column:{type:"column_ref",table:null,column:o},definition:a,resource:"column",...s||{}}):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u),r}function sa(){var t,e,n;return t=Mu,function(){var t,e,n,o;t=Mu,"collate"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(mr));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="COLLATE"):(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u?((e=lc())===u&&(e=null),e!==u&&Tc()!==u&&(n=_s())!==u?(Du=t,t={type:"collate",keyword:"collate",collate:{name:n,symbol:e}}):(Mu=t,t=u)):(Mu=t,t=u),t}function ia(){var t,e,n;return t=Mu,"first"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(W)),e!==u&&(Du=t,e={keyword:e}),(t=e)===u&&(t=Mu,"after"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Y)),e!==u&&Tc()!==u&&(n=Es())!==u?(Du=t,t=e=function(r,t){return {keyword:r,expr:t}}(e,n)):(Mu=t,t=u)),t}function ca(){var t,e,n;return (t=function(){var r,t;r=Mu,fc()!==u&&Tc()!==u&&(t=ba())!==u?(Du=r,r={action:"add",create_definitions:t,resource:"constraint",type:"alter"}):(Mu=r,r=u);return r}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=ai())!==u&&Tc()!==u?("check"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(_)),n!==u&&Tc()!==u&&(o=Us())!==u?(Du=t,e={action:"drop",constraint:o,keyword:n.toLowerCase(),resource:"constraint",type:"alter"},t=e):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=ai())!==u&&Tc()!==u?("primary"===r.substr(Mu,7).toLowerCase()?(n=r.substr(Mu,7),Mu+=7):(n=u,0===Hu&&Yu(N)),n!==u&&(o=Tc())!==u&&(a=vc())!==u?(Du=t,t=e={action:"drop",key:"",keyword:"primary key",resource:"key",type:"alter"}):(Mu=t,t=u)):(Mu=t,t=u);t===u&&(t=Mu,(e=ai())!==u&&Tc()!==u?(n=Mu,"foreign"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(V)),o===u&&(o=null),o!==u&&(a=Tc())!==u&&(s=vc())!==u?n=o=[o,a,s]:(Mu=n,n=u),n===u&&(n=bc()),n!==u&&(o=Tc())!==u&&(a=_s())!==u?(Du=t,e=function(r,t){const e=Array.isArray(r)?"key":"index";return {action:"drop",[e]:t,keyword:Array.isArray(r)?""+[r[0],r[2]].filter(r=>r).join(" ").toLowerCase():r.toLowerCase(),resource:e,type:"alter"}}(n,a),t=e):(Mu=t,t=u)):(Mu=t,t=u));return t}())===u&&(t=function(){var r,t,e,n;r=Mu,(t=fc())!==u&&Tc()!==u?((e=pc())===u&&(e=null),e!==u&&Tc()!==u&&(n=aa())!==u?(Du=r,o=e,a=n,t={action:"add",...a,keyword:o,resource:"column",type:"alter"},r=t):(Mu=r,r=u)):(Mu=r,r=u);var o,a;return r}())===u&&(t=function(){var r,t,e;r=Mu,ai()!==u&&Tc()!==u?((t=pc())===u&&(t=null),t!==u&&Tc()!==u&&(e=Es())!==u?(Du=r,r={action:"drop",column:e,keyword:t,resource:"column",type:"alter"}):(Mu=r,r=u)):(Mu=r,r=u);return r}())===u&&(t=function(){var t,e,n,o,a;t=Mu,(e=function(){var t,e,n,o;t=Mu,"modify"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(eu));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MODIFY"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u?((n=pc())===u&&(n=null),n!==u&&Tc()!==u&&(o=aa())!==u&&Tc()!==u?((a=ia())===u&&(a=null),a!==u?(Du=t,s=o,i=a,e={action:"modify",keyword:n,...s,suffix:i,resource:"column",type:"alter"},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var s,i;return t}())===u&&(t=function(){var r,t,e;r=Mu,(t=fc())!==u&&Tc()!==u&&(e=pa())!==u?(Du=r,n=e,t={action:"add",type:"alter",...n},r=t):(Mu=r,r=u);var n;return r}())===u&&(t=function(){var r,t,e,n,o;r=Mu,(t=bi())!==u&&Tc()!==u&&pc()!==u&&Tc()!==u&&(e=Es())!==u&&Tc()!==u?((n=oi())===u&&(n=hi()),n===u&&(n=null),n!==u&&Tc()!==u&&(o=Es())!==u?(Du=r,s=o,t={action:"rename",type:"alter",resource:"column",keyword:"column",old_column:e,prefix:(a=n)&&a[0].toLowerCase(),column:s},r=t):(Mu=r,r=u)):(Mu=r,r=u);var a,s;return r}())===u&&(t=function(){var r,t,e,n;r=Mu,(t=bi())!==u&&Tc()!==u?((e=oi())===u&&(e=hi()),e===u&&(e=null),e!==u&&Tc()!==u&&(n=_s())!==u?(Du=r,a=n,t={action:"rename",type:"alter",resource:"table",keyword:(o=e)&&o[0].toLowerCase(),table:a},r=t):(Mu=r,r=u)):(Mu=r,r=u);var o,a;return r}())===u&&(t=la())===u&&(t=fa())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,"change"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Q));e!==u&&Tc()!==u?((n=pc())===u&&(n=null),n!==u&&Tc()!==u&&(o=Es())!==u&&Tc()!==u&&(a=aa())!==u&&Tc()!==u?((s=ia())===u&&(s=null),s!==u?(Du=t,i=n,c=a,l=s,e={action:"change",old_column:o,...c,keyword:i,resource:"column",type:"alter",suffix:l},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var i,c,l;return t}())===u&&(t=Mu,(e=wa())!==u&&(Du=t,(n=e).resource=n.keyword,n[n.keyword]=n.value,delete n.value,e={type:"alter",...n}),t=e),t}function la(){var t,e,n,o;return t=Mu,"algorithm"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(X)),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u?("default"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(M)),o===u&&("instant"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(K)),o===u&&("inplace"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(z)),o===u&&("copy"===r.substr(Mu,4).toLowerCase()?(o=r.substr(Mu,4),Mu+=4):(o=u,0===Hu&&Yu(Z))))),o!==u?(Du=t,t=e={type:"alter",keyword:"algorithm",resource:"algorithm",symbol:n,algorithm:o}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t}function fa(){var t,e,n,o;return t=Mu,"lock"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(J)),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u?("default"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(M)),o===u&&("none"===r.substr(Mu,4).toLowerCase()?(o=r.substr(Mu,4),Mu+=4):(o=u,0===Hu&&Yu(rr)),o===u&&("shared"===r.substr(Mu,6).toLowerCase()?(o=r.substr(Mu,6),Mu+=6):(o=u,0===Hu&&Yu(tr)),o===u&&("exclusive"===r.substr(Mu,9).toLowerCase()?(o=r.substr(Mu,9),Mu+=9):(o=u,0===Hu&&Yu(er))))),o!==u?(Du=t,t=e={type:"alter",keyword:"lock",resource:"lock",symbol:n,lock:o}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t}function pa(){var r,t,e,n,o,a,s,i;return r=Mu,(t=bc())===u&&(t=vc()),t!==u&&Tc()!==u?((e=Os())===u&&(e=null),e!==u&&Tc()!==u?((n=Na())===u&&(n=null),n!==u&&Tc()!==u&&(o=ga())!==u&&Tc()!==u?((a=Oa())===u&&(a=null),a!==u&&Tc()!==u?(Du=r,s=n,i=a,r=t={index:e,definition:o,keyword:t.toLowerCase(),index_type:s,resource:"index",index_options:i}):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u),r}function ba(){var t;return (t=function(){var t,e,n,o,a,s,i,c;t=Mu,(e=va())===u&&(e=null);e!==u&&Tc()!==u?(n=Mu,"primary"===r.substr(Mu,7).toLowerCase()?(o=r.substr(Mu,7),Mu+=7):(o=u,0===Hu&&Yu(N)),o!==u&&(a=Tc())!==u?("key"===r.substr(Mu,3).toLowerCase()?(s=r.substr(Mu,3),Mu+=3):(s=u,0===Hu&&Yu(I)),s!==u?n=o=[o,a,s]:(Mu=n,n=u)):(Mu=n,n=u),n!==u&&(o=Tc())!==u?((a=Na())===u&&(a=null),a!==u&&(s=Tc())!==u&&(i=ga())!==u&&Tc()!==u?((c=Oa())===u&&(c=null),c!==u?(Du=t,f=n,p=a,b=i,v=c,e={constraint:(l=e)&&l.constraint,definition:b,constraint_type:`${f[0].toLowerCase()} ${f[2].toLowerCase()}`,keyword:l&&l.keyword,index_type:p,resource:"constraint",index_options:v},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var l,f,p,b,v;return t}())===u&&(t=function(){var r,t,e,n,o,a,s,i;r=Mu,(t=va())===u&&(t=null);t!==u&&Tc()!==u&&(e=yc())!==u&&Tc()!==u?((n=bc())===u&&(n=vc()),n===u&&(n=null),n!==u&&Tc()!==u?((o=Os())===u&&(o=null),o!==u&&Tc()!==u?((a=Na())===u&&(a=null),a!==u&&Tc()!==u&&(s=ga())!==u&&Tc()!==u?((i=Oa())===u&&(i=null),i!==u?(Du=r,l=e,f=n,p=o,b=a,v=s,y=i,t={constraint:(c=t)&&c.constraint,definition:v,constraint_type:f&&`${l.toLowerCase()} ${f.toLowerCase()}`||l.toLowerCase(),keyword:c&&c.keyword,index_type:b,index:p,resource:"constraint",index_options:y},r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u);var c,l,f,p,b,v,y;return r}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=va())===u&&(e=null);e!==u&&Tc()!==u?("foreign key"===r.substr(Mu,11).toLowerCase()?(n=r.substr(Mu,11),Mu+=11):(n=u,0===Hu&&Yu(ur)),n!==u&&Tc()!==u?((o=Os())===u&&(o=null),o!==u&&Tc()!==u&&(a=ga())!==u&&Tc()!==u?((s=ya())===u&&(s=null),s!==u?(Du=t,c=n,l=o,f=a,p=s,e={constraint:(i=e)&&i.constraint,definition:f,constraint_type:c,keyword:i&&i.keyword,index:l,resource:"constraint",reference_definition:p},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var i,c,l,f,p;return t}())===u&&(t=function(){var t,e,n,o,a,s,i,c,l,f;t=Mu,(e=va())===u&&(e=null);e!==u&&Tc()!==u?("check"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(_)),n!==u&&Tc()!==u?(o=Mu,"not"===r.substr(Mu,3).toLowerCase()?(a=r.substr(Mu,3),Mu+=3):(a=u,0===Hu&&Yu(nr)),a!==u&&(s=Tc())!==u?("for"===r.substr(Mu,3).toLowerCase()?(i=r.substr(Mu,3),Mu+=3):(i=u,0===Hu&&Yu(C)),i!==u&&(c=Tc())!==u?("replication"===r.substr(Mu,11).toLowerCase()?(l=r.substr(Mu,11),Mu+=11):(l=u,0===Hu&&Yu(or)),l!==u&&(f=Tc())!==u?o=a=[a,s,i,c,l,f]:(Mu=o,o=u)):(Mu=o,o=u)):(Mu=o,o=u),o===u&&(o=null),o!==u&&(a=Cc())!==u&&(s=Tc())!==u&&(i=$a())!==u&&(c=Tc())!==u&&(l=Ac())!==u?(Du=t,p=e,b=o,v=i,e={constraint_type:n.toLowerCase(),keyword:p&&p.keyword,constraint:p&&p.constraint,index_type:b&&{keyword:"not for replication"},definition:[v],resource:"constraint"},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var p,b,v;return t}()),t}function va(){var r,t,e,n;return r=Mu,(t=hc())!==u&&Tc()!==u?((e=_s())===u&&(e=null),e!==u?(Du=r,n=e,r=t={keyword:t.toLowerCase(),constraint:n}):(Mu=r,r=u)):(Mu=r,r=u),r}function ya(){var t,e,n,o,a,s,i,c,l,f;return t=Mu,(e=function(){var t,e,n,o;t=Mu,"references"===r.substr(Mu,10).toLowerCase()?(e=r.substr(Mu,10),Mu+=10):(e=u,0===Hu&&Yu(su));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="REFERENCES"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&(n=Fa())!==u&&Tc()!==u&&(o=ga())!==u&&Tc()!==u?("match full"===r.substr(Mu,10).toLowerCase()?(a=r.substr(Mu,10),Mu+=10):(a=u,0===Hu&&Yu(sr)),a===u&&("match partial"===r.substr(Mu,13).toLowerCase()?(a=r.substr(Mu,13),Mu+=13):(a=u,0===Hu&&Yu(ir)),a===u&&("match simple"===r.substr(Mu,12).toLowerCase()?(a=r.substr(Mu,12),Mu+=12):(a=u,0===Hu&&Yu(cr)))),a===u&&(a=null),a!==u&&Tc()!==u?((s=da())===u&&(s=null),s!==u&&Tc()!==u?((i=da())===u&&(i=null),i!==u?(Du=t,c=a,l=s,f=i,t=e={definition:o,table:[n],keyword:e.toLowerCase(),match:c&&c.toLowerCase(),on_action:[l,f].filter(r=>r)}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=da())!==u&&(Du=t,e={on_action:[e]}),t=e),t}function da(){var t,e,n,o;return t=Mu,Ci()!==u&&Tc()!==u?((e=fi())===u&&(e=si()),e!==u&&Tc()!==u&&(n=function(){var t,e,n;t=Mu,(e=ac())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u?((n=es())===u&&(n=null),n!==u&&Tc()!==u&&Ac()!==u?(Du=t,t=e={type:"function",name:{name:[{type:"origin",value:e}]},args:n}):(Mu=t,t=u)):(Mu=t,t=u);t===u&&(t=Mu,"restrict"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(lr)),e===u&&("cascade"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(fr)),e===u&&("set null"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(pr)),e===u&&("no action"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(br)),e===u&&("set default"===r.substr(Mu,11).toLowerCase()?(e=r.substr(Mu,11),Mu+=11):(e=u,0===Hu&&Yu(vr)),e===u&&(e=ac()))))),e!==u&&(Du=t,e={type:"origin",value:e.toLowerCase()}),t=e);return t}())!==u?(Du=t,o=n,t={type:"on "+e[0].toLowerCase(),value:o}):(Mu=t,t=u)):(Mu=t,t=u),t}function ha(){var t,e,n;return t=Mu,"character"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(yr)),e!==u&&Tc()!==u?("set"===r.substr(Mu,3).toLowerCase()?(n=r.substr(Mu,3),Mu+=3):(n=u,0===Hu&&Yu(dr)),n!==u?(Du=t,t=e="CHARACTER SET"):(Mu=t,t=u)):(Mu=t,t=u),t}function ma(){var t,e,n,o,a,s,i,c,l;return t=Mu,(e=ni())===u&&(e=null),e!==u&&Tc()!==u?((n=ha())===u&&("charset"===r.substr(Mu,7).toLowerCase()?(n=r.substr(Mu,7),Mu+=7):(n=u,0===Hu&&Yu(hr)),n===u&&("collate"===r.substr(Mu,7).toLowerCase()?(n=r.substr(Mu,7),Mu+=7):(n=u,0===Hu&&Yu(mr)))),n!==u&&Tc()!==u?((o=lc())===u&&(o=null),o!==u&&Tc()!==u&&(a=js())!==u?(Du=t,i=n,c=o,l=a,t=e={keyword:(s=e)&&`${s[0].toLowerCase()} ${i.toLowerCase()}`||i.toLowerCase(),symbol:c,value:l}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t}function wa(){var t,e,n,o,a,s,i,c,l;return t=Mu,"auto_increment"===r.substr(Mu,14).toLowerCase()?(e=r.substr(Mu,14),Mu+=14):(e=u,0===Hu&&Yu(S)),e===u&&("avg_row_length"===r.substr(Mu,14).toLowerCase()?(e=r.substr(Mu,14),Mu+=14):(e=u,0===Hu&&Yu(wr)),e===u&&("key_block_size"===r.substr(Mu,14).toLowerCase()?(e=r.substr(Mu,14),Mu+=14):(e=u,0===Hu&&Yu(Lr)),e===u&&("max_rows"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(Cr)),e===u&&("min_rows"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(Ar)),e===u&&("stats_sample_pages"===r.substr(Mu,18).toLowerCase()?(e=r.substr(Mu,18),Mu+=18):(e=u,0===Hu&&Yu(Er))))))),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ks())!==u?(Du=t,c=n,l=o,t=e={keyword:e.toLowerCase(),symbol:c,value:l.value}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=ma())===u&&(t=Mu,(e=dc())===u&&("connection"===r.substr(Mu,10).toLowerCase()?(e=r.substr(Mu,10),Mu+=10):(e=u,0===Hu&&Yu(gr))),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ys())!==u?(Du=t,t=e=function(r,t,e){return {keyword:r.toLowerCase(),symbol:t,value:`'${e.value}'`}}(e,n,o)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"compression"===r.substr(Mu,11).toLowerCase()?(e=r.substr(Mu,11),Mu+=11):(e=u,0===Hu&&Yu(jr)),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u?(o=Mu,39===r.charCodeAt(Mu)?(a="'",Mu++):(a=u,0===Hu&&Yu(_r)),a!==u?("zlib"===r.substr(Mu,4).toLowerCase()?(s=r.substr(Mu,4),Mu+=4):(s=u,0===Hu&&Yu(Tr)),s===u&&("lz4"===r.substr(Mu,3).toLowerCase()?(s=r.substr(Mu,3),Mu+=3):(s=u,0===Hu&&Yu(Sr)),s===u&&("none"===r.substr(Mu,4).toLowerCase()?(s=r.substr(Mu,4),Mu+=4):(s=u,0===Hu&&Yu(rr)))),s!==u?(39===r.charCodeAt(Mu)?(i="'",Mu++):(i=u,0===Hu&&Yu(_r)),i!==u?o=a=[a,s,i]:(Mu=o,o=u)):(Mu=o,o=u)):(Mu=o,o=u),o!==u?(Du=t,t=e=function(r,t,e){return {keyword:r.toLowerCase(),symbol:t,value:e.join("").toUpperCase()}}(e,n,o)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"engine"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(xr)),e!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u&&(o=Us())!==u?(Du=t,t=e=function(r,t,e){return {keyword:r.toLowerCase(),symbol:t,value:e.toUpperCase()}}(e,n,o)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"without"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(kr)),e!==u&&Tc()!==u?("rowid"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(Ir)),n!==u?(Du=t,t=e={keyword:"without rowid"}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"strict"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Nr)),e!==u&&(Du=t,e={keyword:"strict"}),t=e))))),t}function La(){var t,e,n,o,a;return t=Mu,(e=Da())!==u&&Tc()!==u&&(n=function(){var t,e,n;return t=Mu,"read"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Or)),e!==u&&Tc()!==u?("local"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(j)),n===u&&(n=null),n!==u?(Du=t,t=e={type:"read",suffix:n&&"local"}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"low_priority"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(Rr)),e===u&&(e=null),e!==u&&Tc()!==u?("write"===r.substr(Mu,5).toLowerCase()?(n=r.substr(Mu,5),Mu+=5):(n=u,0===Hu&&Yu(Ur)),n!==u?(Du=t,t=e={type:"write",prefix:e&&"low_priority"}):(Mu=t,t=u)):(Mu=t,t=u)),t}())!==u?(Du=t,o=e,a=n,nl.add(`lock::${o.db}::${o.table}`),t=e={table:o,lock_type:a}):(Mu=t,t=u),t}function Ca(){var t,e,n,o,a,s,i;return (t=ja())===u&&(t=Mu,e=Mu,40===r.charCodeAt(Mu)?(n="(",Mu++):(n=u,0===Hu&&Yu(qr)),n!==u&&(o=Tc())!==u&&(a=Ca())!==u&&(s=Tc())!==u?(41===r.charCodeAt(Mu)?(i=")",Mu++):(i=u,0===Hu&&Yu(Wr)),i!==u?e=n=[n,o,a,s,i]:(Mu=e,e=u)):(Mu=e,e=u),e!==u&&(Du=t,e={...e[2],parentheses_symbol:true}),t=e),t}function Aa(){var t,e,n,o,a,s,i,c,l,f,p,b,v;if(t=Mu,ji()!==u)if(Tc()!==u)if((e=Ea())!==u){for(n=[],o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=Ea())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=Ea())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);n!==u?(Du=t,t=T(e,n)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;if(t===u)if(t=Mu,Tc()!==u)if(ji()!==u)if((e=Tc())!==u)if((n=function(){var t,e,n,o;t=Mu,"recursive"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(tn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u)if((o=Tc())!==u)if((a=Ea())!==u){for(s=[],i=Mu,(c=Tc())!==u&&(l=wc())!==u&&(f=Tc())!==u&&(p=Ea())!==u?i=c=[c,l,f,p]:(Mu=i,i=u);i!==u;)s.push(i),i=Mu,(c=Tc())!==u&&(l=wc())!==u&&(f=Tc())!==u&&(p=Ea())!==u?i=c=[c,l,f,p]:(Mu=i,i=u);s!==u?(Du=t,v=s,(b=a).recursive=true,t=Zc(b,v)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;return t}function Ea(){var r,t,e,n,o,a,s;return r=Mu,(t=Ys())===u&&(t=Us())===u&&(t=Fa()),t!==u&&Tc()!==u?((e=ga())===u&&(e=null),e!==u&&Tc()!==u&&hi()!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=Ju())!==u&&Tc()!==u&&Ac()!==u?(Du=r,a=e,s=n,"string"==typeof(o=t)&&(o={type:"default",value:o}),o.table&&(o={type:"default",value:o.table}),r=t={name:o,stmt:s,columns:a}):(Mu=r,r=u)):(Mu=r,r=u),r}function ga(){var r,t;return r=Mu,Cc()!==u&&Tc()!==u&&(t=function(){var r;(r=Ga())===u&&(r=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=qs())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=qs())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=qs())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=T(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}());return r}())!==u&&Tc()!==u&&Ac()!==u?(Du=r,r=t):(Mu=r,r=u),r}function ja(){var t,e,n,o,a,s,i,c,l,f,p,b,v,y,d,h,m,w,L,A,E,g,j,_,T,S;return t=Mu,Tc()!==u?((e=Aa())===u&&(e=null),e!==u&&Tc()!==u&&function(){var t,e,n,o;t=Mu,"select"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Qe));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Sc()!==u?((n=function(){var r,t,e,n,o,a;if(r=Mu,(t=_a())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=_a())!==u?n=o=[o,a]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=_a())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u?(Du=r,t=function(r,t){const e=[r];for(let r=0,n=t.length;r<n;++r)e.push(t[r][1]);return e}(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())===u&&(n=null),n!==u&&Tc()!==u?((o=ki())===u&&(o=null),o!==u&&Tc()!==u&&(a=Ta())!==u&&Tc()!==u?((s=ka())===u&&(s=null),s!==u&&Tc()!==u?((i=Ba())===u&&(i=null),i!==u&&Tc()!==u?((c=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;t=Mu,"group"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(An));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u&&_i()!==u&&Tc()!==u&&(n=es())!==u?(Du=t,e={columns:n.value},t=e):(Mu=t,t=u);return t}())===u&&(c=null),c!==u&&Tc()!==u?((l=function(){var t,e;t=Mu,function(){var t,e,n,o;t=Mu,"having"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(jn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=cs())!==u?(Du=t,t=e):(Mu=t,t=u);return t}())===u&&(l=null),l!==u&&Tc()!==u?((f=qa())===u&&(f=null),f!==u&&Tc()!==u?((p=Va())===u&&(p=null),p!==u?(b=Mu,"for"===r.substr(Mu,3).toLowerCase()?(v=r.substr(Mu,3),Mu+=3):(v=u,0===Hu&&Yu(C)),v!==u&&(y=Tc())!==u&&(d=si())!==u?b=v=[v,y,d]:(Mu=b,b=u),b===u&&(b=null),b!==u?(Du=t,h=e,m=n,w=o,L=a,E=i,g=c,j=l,_=f,T=p,S=b,(A=s)&&A.forEach(r=>r.table&&nl.add(`select::${r.db}::${r.table}`)),t={with:h,type:"select",options:m,distinct:w,columns:L,from:A,where:E,groupby:g,having:j,orderby:_,limit:T,for_update:S&&`${S[0]} ${S[2][0]}`}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t}function _a(){var t,e;return t=Mu,(e=function(){var t;"sql_calc_found_rows"===r.substr(Mu,19).toLowerCase()?(t=r.substr(Mu,19),Mu+=19):(t=u,0===Hu&&Yu(iu));return t}())===u&&((e=function(){var t;"sql_cache"===r.substr(Mu,9).toLowerCase()?(t=r.substr(Mu,9),Mu+=9):(t=u,0===Hu&&Yu(cu));return t}())===u&&(e=function(){var t;"sql_no_cache"===r.substr(Mu,12).toLowerCase()?(t=r.substr(Mu,12),Mu+=12):(t=u,0===Hu&&Yu(lu));return t}()),e===u&&(e=function(){var t;"sql_big_result"===r.substr(Mu,14).toLowerCase()?(t=r.substr(Mu,14),Mu+=14):(t=u,0===Hu&&Yu(pu));return t}())===u&&(e=function(){var t;"sql_small_result"===r.substr(Mu,16).toLowerCase()?(t=r.substr(Mu,16),Mu+=16):(t=u,0===Hu&&Yu(fu));return t}())===u&&(e=function(){var t;"sql_buffer_result"===r.substr(Mu,17).toLowerCase()?(t=r.substr(Mu,17),Mu+=17):(t=u,0===Hu&&Yu(bu));return t}())),e!==u&&(Du=t,e=e),t=e}function Ta(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=xi())===u&&(t=Mu,(e=Lc())!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Lc())),t!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Sa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Sa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){ol.add("select::null::(.*)");const e={expr:{type:"column_ref",table:null,column:"*"},as:null};return t&&t.length>0?Zc(e,t):[e]}(0,e)):(Mu=r,r=u);}else Mu=r,r=u;if(r===u)if(r=Mu,(t=Sa())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Sa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Sa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=T(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Sa(){var r,t,e,n,o,a,s;return r=Mu,t=Mu,(e=_s())!==u&&(n=Tc())!==u&&(o=mc())!==u?t=e=[e,n,o]:(Mu=t,t=u),t===u&&(t=null),t!==u&&(e=Tc())!==u&&(n=Lc())!==u?(Du=r,r=t=function(r){const t=r&&r[0]||null;return ol.add(`select::${t}::(.*)`),{expr:{type:"column_ref",table:t,column:"*"},as:null}}(t)):(Mu=r,r=u),r===u&&(r=Mu,(t=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=is())!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi())===u&&(a=_c()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi())===u&&(a=_c()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,t=function(r,t){const e=r.ast;if(e&&"select"===e.type&&(!(r.parentheses_symbol||r.parentheses||r.ast.parentheses||r.ast.parentheses_symbol)||1!==e.columns.length||"*"===e.columns[0].expr.column))throw new Error("invalid column clause with select statement");if(!t||0===t.length)return r;const n=t.length;let o=t[n-1][3];for(let e=n-1;e>=0;e--){const n=0===e?r:t[e-1][3];o=Kc(t[e][1],n,o);}return o}(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u&&(e=Tc())!==u?((n=xa())===u&&(n=null),n!==u?(Du=r,s=n,"double_quote_string"!==(a=t).type&&"single_quote_string"!==a.type||ol.add("select::null::"+a.value),r=t={expr:a,as:s}):(Mu=r,r=u)):(Mu=r,r=u)),r}function xa(){var r,t,e;return r=Mu,(t=hi())!==u&&Sc()!==u&&(e=function(){var r,t;r=Mu,(t=Us())!==u?(Du=Mu,(function(r){if(true===Vc[r.toUpperCase()])throw new Error("Error: "+JSON.stringify(r)+" is a reserved word, can not as alias clause");return  false}(t)?u:void 0)!==u?(Du=r,r=t=t):(Mu=r,r=u)):(Mu=r,r=u);r===u&&(r=Mu,(t=Ss())!==u&&(Du=r,t=t),r=t);return r}())!==u?(Du=r,r=t=e):(Mu=r,r=u),r===u&&(r=Mu,(t=hi())===u&&(t=null),t!==u&&Tc()!==u&&(e=_s())!==u?(Du=r,r=t=e):(Mu=r,r=u)),r}function ka(){var t,e;return t=Mu,function(){var t,e,n,o;t=Mu,"from"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(an));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=Ua())!==u?(Du=t,t=e):(Mu=t,t=u),t}function Ia(){var r,t,e;return r=Mu,(t=Fa())!==u&&Tc()!==u&&oi()!==u&&Tc()!==u&&(e=Fa())!==u?(Du=r,r=t=[t,e]):(Mu=r,r=u),r}function Na(){var t,e;return t=Mu,gi()!==u&&Tc()!==u?("btree"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Yr)),e===u&&("hash"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Vr))),e!==u?(Du=t,t={keyword:"using",type:e.toLowerCase()}):(Mu=t,t=u)):(Mu=t,t=u),t}function Oa(){var r,t,e,n,o,a;if(r=Mu,(t=Ra())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=Ra())!==u?n=o=[o,a]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Ra())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){const e=[r];for(let r=0;r<t.length;r++)e.push(t[r][1]);return e}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Ra(){var t,e,n,o,a,s;return t=Mu,(e=function(){var t,e,n,o;t=Mu,"key_block_size"===r.substr(Mu,14).toLowerCase()?(e=r.substr(Mu,14),Mu+=14):(e=u,0===Hu&&Yu(Lr));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="KEY_BLOCK_SIZE"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u?((n=lc())===u&&(n=null),n!==u&&Tc()!==u&&(o=Ks())!==u?(Du=t,a=n,s=o,t=e={type:e.toLowerCase(),symbol:a,expr:s}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Na())===u&&(t=Mu,"with"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Qr)),e!==u&&Tc()!==u?("parser"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(Xr)),n!==u&&Tc()!==u&&(o=Us())!==u?(Du=t,t=e={type:"with parser",expr:o}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,"visible"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(Kr)),e===u&&("invisible"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(zr))),e!==u&&(Du=t,e=function(r){return {type:r.toLowerCase(),expr:r.toLowerCase()}}(e)),(t=e)===u&&(t=kc()))),t}function Ua(){var r,t,e,n;if(r=Mu,(t=Da())!==u){for(e=[],n=Ma();n!==u;)e.push(n),n=Ma();e!==u?(Du=r,r=t=Zr(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Ma(){var r,t,e;return r=Mu,Tc()!==u&&(t=wc())!==u&&Tc()!==u&&(e=Da())!==u?(Du=r,r=e):(Mu=r,r=u),r===u&&(r=Mu,Tc()!==u&&(t=function(){var r,t,e,n,o,a,s,i,c,l,f;if(r=Mu,(t=Pa())!==u)if(Tc()!==u)if((e=Da())!==u)if(Tc()!==u)if((n=gi())!==u)if(Tc()!==u)if(Cc()!==u)if(Tc()!==u)if((o=js())!==u){for(a=[],s=Mu,(i=Tc())!==u&&(c=wc())!==u&&(l=Tc())!==u&&(f=js())!==u?s=i=[i,c,l,f]:(Mu=s,s=u);s!==u;)a.push(s),s=Mu,(i=Tc())!==u&&(c=wc())!==u&&(l=Tc())!==u&&(f=js())!==u?s=i=[i,c,l,f]:(Mu=s,s=u);a!==u&&(s=Tc())!==u&&(i=Ac())!==u?(Du=r,p=t,v=o,y=a,(b=e).join=p,b.using=Zc(v,y),r=t=b):(Mu=r,r=u);}else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;var p,b,v,y;r===u&&(r=Mu,(t=Pa())!==u&&Tc()!==u&&(e=Da())!==u&&Tc()!==u?((n=Ha())===u&&(n=null),n!==u?(Du=r,t=function(r,t,e){return t.join=r,t.on=e,t}(t,e,n),r=t):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=Pa())===u&&(t=Zu()),t!==u&&Tc()!==u&&(e=Cc())!==u&&Tc()!==u&&(n=Ju())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((o=xa())===u&&(o=null),o!==u&&(a=Tc())!==u?((s=Ha())===u&&(s=null),s!==u?(Du=r,t=function(r,t,e,n){return t.parentheses=true,{expr:t,as:e,join:r,on:n}}(t,n,o,s),r=t):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)));return r}())!==u?(Du=r,r=t):(Mu=r,r=u)),r}function Da(){var t,e,n,o,a,s;return t=Mu,(e=function(){var t;"dual"===r.substr(Mu,4).toLowerCase()?(t=r.substr(Mu,4),Mu+=4):(t=u,0===Hu&&Yu(Zo));return t}())!==u&&(Du=t,e={type:"dual"}),(t=e)===u&&(t=Mu,(e=Us())!==u&&Tc()!==u&&(n=Cc())!==u&&Tc()!==u&&(o=es())!==u&&Tc()!==u&&(a=Ac())!==u&&Tc()!==u?((s=xa())===u&&(s=null),s!==u?(Du=t,t=e={expr:{type:"function",name:{name:[{type:"default",value:e}]},args:o},as:s}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=Fa())!==u&&Tc()!==u?((n=xa())===u&&(n=null),n!==u?(Du=t,t=e=function(r,t){return "var"===r.type?(r.as=t,r):{db:r.db,table:r.table,as:t}}(e,n)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=Cc())!==u&&Tc()!==u&&(n=Ju())!==u&&Tc()!==u&&(o=Ac())!==u&&Tc()!==u?((a=xa())===u&&(a=null),a!==u?(Du=t,t=e=function(r,t){return r.parentheses=true,{expr:r,as:t}}(n,a)):(Mu=t,t=u)):(Mu=t,t=u)))),t}function Pa(){var t,e,n,o;return t=Mu,(e=function(){var t,e,n,o;t=Mu,"left"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(bn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(n=Tc())!==u?((o=function(){var t,e,n,o;t=Mu,"outer"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(dn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(o=null),o!==u&&Tc()!==u&&Ai()!==u?(Du=t,t=e="LEFT JOIN"):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,e=Mu,(n=function(){var t,e,n,o;t=Mu,"inner"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(vn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(o=Tc())!==u?e=n=[n,o]:(Mu=e,e=u),e===u&&(e=null),e!==u&&(n=Ai())!==u?(Du=t,t=e="INNER JOIN"):(Mu=t,t=u)),t}function Fa(){var r,t,e,n,o,a,s,i;return r=Mu,(t=_s())!==u?(e=Mu,(n=Tc())!==u&&(o=mc())!==u&&(a=Tc())!==u&&(s=_s())!==u?e=n=[n,o,a,s]:(Mu=e,e=u),e===u&&(e=null),e!==u?(Du=r,r=t=function(r,t){const e={db:null,table:r};return null!==t&&(e.db=r,e.table=t[3]),e}(t,e)):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=Gc())!==u&&(Du=r,(i=t).db=null,i.table=i.name,t=i),r=t),r}function $a(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=is())!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){const e=t.length;let n=r;for(let r=0;r<e;++r)n=Kc(t[r][1],n,t[r][3]);return n}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Ha(){var r,t;return r=Mu,Ci()!==u&&Tc()!==u&&(t=cs())!==u?(Du=r,r=t):(Mu=r,r=u),r}function Ba(){var t,e;return t=Mu,function(){var t,e,n,o;t=Mu,"where"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Cn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=cs())!==u?(Du=t,t=e):(Mu=t,t=u),t}function Ga(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Es())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Es())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Es())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=T(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function qa(){var t,e;return t=Mu,function(){var t,e,n,o;t=Mu,"order"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(gn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&_i()!==u&&Tc()!==u&&(e=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Wa())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Wa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Wa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=T(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=t,t=e):(Mu=t,t=u),t}function Wa(){var r,t,e;return r=Mu,(t=is())!==u&&Tc()!==u?((e=Si())===u&&(e=Ti()),e===u&&(e=null),e!==u?(Du=r,r=t={expr:t,type:e}):(Mu=r,r=u)):(Mu=r,r=u),r}function Ya(){var r;return (r=Ks())===u&&(r=Fs()),r}function Va(){var t,e,n,o,a,s;return t=Mu,function(){var t,e,n,o;t=Mu,"limit"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(_n));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=Ya())!==u&&Tc()!==u?(n=Mu,(o=wc())===u&&(o=function(){var t,e,n,o;t=Mu,"offset"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Tn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="OFFSET"):(Mu=t,t=u)):(Mu=t,t=u);return t}()),o!==u&&(a=Tc())!==u&&(s=Ya())!==u?n=o=[o,a,s]:(Mu=n,n=u),n===u&&(n=null),n!==u?(Du=t,t=function(r,t){const e=[r];return t&&e.push(t[2]),{seperator:t&&t[0]&&t[0].toLowerCase()||"",value:e}}(e,n)):(Mu=t,t=u)):(Mu=t,t=u),t}function Qa(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Xa())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Xa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Xa())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=T(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Xa(){var t,e,n,o,a,s,i,c,l;return t=Mu,e=Mu,(n=_s())!==u&&(o=Tc())!==u&&(a=mc())!==u?e=n=[n,o,a]:(Mu=e,e=u),e===u&&(e=null),e!==u&&(n=Tc())!==u&&(o=Ns())!==u&&(a=Tc())!==u?(61===r.charCodeAt(Mu)?(s="=",Mu++):(s=u,0===Hu&&Yu(Jr)),s!==u&&Tc()!==u&&(i=is())!==u?(Du=t,t=e={column:o,value:i,table:(l=e)&&l[0]}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,e=Mu,(n=_s())!==u&&(o=Tc())!==u&&(a=mc())!==u?e=n=[n,o,a]:(Mu=e,e=u),e===u&&(e=null),e!==u&&(n=Tc())!==u&&(o=Ns())!==u&&(a=Tc())!==u?(61===r.charCodeAt(Mu)?(s="=",Mu++):(s=u,0===Hu&&Yu(Jr)),s!==u&&Tc()!==u&&(i=Ei())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(c=Es())!==u&&Tc()!==u&&Ac()!==u?(Du=t,t=e=function(r,t,e){return {column:t,value:e,table:r&&r[0],keyword:"values"}}(e,o,c)):(Mu=t,t=u)):(Mu=t,t=u)),t}function Ka(){var t,e,n,o,a;return t=Mu,(e=function(){var t,e,n,o;t=Mu,"returning"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(nn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="RETURNING"):(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&Tc()!==u?((n=Ta())===u&&(n=Ca()),n!==u?(Du=t,a=n,t=e={type:(o=e)&&o.toLowerCase()||"returning",columns:"*"===a&&[{type:"expr",expr:{type:"column_ref",table:null,column:"*"},as:null}]||a}):(Mu=t,t=u)):(Mu=t,t=u),t}function za(){var r,t;return (r=function(){var r,t;r=Mu,Ei()!==u&&Tc()!==u&&(t=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=ts())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=ts())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=ts())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=T(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())!==u?(Du=r,r={type:"values",values:t}):(Mu=r,r=u);return r}())===u&&(r=Mu,(t=Ju())!==u&&(Du=r,t=t.ast),r=t),r}function Za(){var r,t,e,n,o,a,s,i,c;if(r=Mu,vi()!==u)if(Tc()!==u)if((t=Cc())!==u)if(Tc()!==u)if((e=Us())!==u){for(n=[],o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=Us())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,(a=Tc())!==u&&(s=wc())!==u&&(i=Tc())!==u&&(c=Us())!==u?o=a=[a,s,i,c]:(Mu=o,o=u);n!==u&&(o=Tc())!==u&&(a=Ac())!==u?(Du=r,r=Zc(e,n)):(Mu=r,r=u);}else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;else Mu=r,r=u;return r===u&&(r=Mu,vi()!==u&&Tc()!==u&&(t=ts())!==u?(Du=r,r=t):(Mu=r,r=u)),r}function Ja(){var t,e,n;return t=Mu,Ci()!==u&&Tc()!==u?("duplicate"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(rt)),e!==u&&Tc()!==u&&vc()!==u&&Tc()!==u&&si()!==u&&Tc()!==u&&(n=Qa())!==u?(Du=t,t={keyword:"on duplicate key update",set:n}):(Mu=t,t=u)):(Mu=t,t=u),t}function rs(){var t,e,n,o,a,s,i;return t=Mu,(e=pi())!==u?(n=Mu,(o=Tc())!==u&&(a=Pi())!==u&&(s=Tc())!==u?("abort"===r.substr(Mu,5).toLowerCase()?(i=r.substr(Mu,5),Mu+=5):(i=u,0===Hu&&Yu(tt)),i===u&&("fail"===r.substr(Mu,4).toLowerCase()?(i=r.substr(Mu,4),Mu+=4):(i=u,0===Hu&&Yu(et)),i===u&&("ignore"===r.substr(Mu,6).toLowerCase()?(i=r.substr(Mu,6),Mu+=6):(i=u,0===Hu&&Yu(nt)),i===u&&("replace"===r.substr(Mu,7).toLowerCase()?(i=r.substr(Mu,7),Mu+=7):(i=u,0===Hu&&Yu(ot)),i===u&&("rollback"===r.substr(Mu,8).toLowerCase()?(i=r.substr(Mu,8),Mu+=8):(i=u,0===Hu&&Yu(ut)))))),i!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u),n===u&&(n=null),n!==u?(Du=t,t=e=function(r){const t={type:"insert"};return r&&0!==r.length?(t.or=[{type:"origin",value:"or"},{type:"origin",value:r[3]}],t):t}(n)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=function(){var t,e,n,o;t=Mu,"replace"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(ot));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={type:"replace"}),t=e),t}function ts(){var r,t;return r=Mu,Cc()!==u&&Tc()!==u&&(t=es())!==u&&Tc()!==u&&Ac()!==u?(Du=r,r=t):(Mu=r,r=u),r}function es(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=is())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){const e={type:"expr_list"};return e.value=Zc(r,t),e}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function ns(){var t,e,n;return t=Mu,function(){var t,e,n,o;t=Mu,"interval"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(ko));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="INTERVAL"):(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=is())!==u&&Tc()!==u&&(n=function(){var t;(t=function(){var t,e,n,o;t=Mu,"year"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Io));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="YEAR"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"month"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(No));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MONTH"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"day"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Oo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DAY"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"hour"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Ro));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="HOUR"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"minute"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Uo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MINUTE"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"second"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Mo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SECOND"):(Mu=t,t=u)):(Mu=t,t=u);return t}());return t}())!==u?(Du=t,t={type:"interval",expr:e,unit:n.toLowerCase()}):(Mu=t,t=u),t}function os(){var r,t,e,n,o,a;if(r=Mu,(t=us())!==u)if(Tc()!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=us())!==u?n=o=[o,a]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=us())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u?(Du=r,r=t=i(t,e)):(Mu=r,r=u);}else Mu=r,r=u;else Mu=r,r=u;return r}function us(){var t,e,n;return t=Mu,$i()!==u&&Tc()!==u&&(e=cs())!==u&&Tc()!==u&&function(){var t,e,n,o;t=Mu,"then"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(zn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(n=is())!==u?(Du=t,t={type:"when",cond:e,result:n}):(Mu=t,t=u),t}function as(){var t,e;return t=Mu,function(){var t,e,n,o;t=Mu,"else"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Zn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&(e=is())!==u?(Du=t,t={type:"else",result:e}):(Mu=t,t=u),t}function ss(){var r;return (r=function(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=ls())!==u){for(e=[],n=Mu,(o=Sc())!==u&&(a=Pi())!==u&&(s=Tc())!==u&&(i=ls())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Sc())!==u&&(a=Pi())!==u&&(s=Tc())!==u&&(i=ls())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,t=at(t,e),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}())===u&&(r=function(){var r,t,e,n,o,a;if(r=Mu,(t=ms())!==u){if(e=[],n=Mu,(o=Tc())!==u&&(a=Cs())!==u?n=o=[o,a]:(Mu=n,n=u),n!==u)for(;n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Cs())!==u?n=o=[o,a]:(Mu=n,n=u);else e=u;e!==u?(Du=r,t=Xc(t,e[0][1]),r=t):(Mu=r,r=u);}else Mu=r,r=u;return r}()),r}function is(){var r;return (r=ss())===u&&(r=Ju()),r}function cs(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=is())!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi())===u&&(a=wc()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=Di())===u&&(a=Pi())===u&&(a=wc()),a!==u&&(s=Tc())!==u&&(i=is())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){const e=t.length;let n=r,o="";for(let r=0;r<e;++r)","===t[r][1]?(o=",",Array.isArray(n)||(n=[n]),n.push(t[r][3])):n=Kc(t[r][1],n,t[r][3]);if(","===o){const r={type:"expr_list"};return r.value=n,r}return n}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function ls(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=fs())!==u){for(e=[],n=Mu,(o=Sc())!==u&&(a=Di())!==u&&(s=Tc())!==u&&(i=fs())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Sc())!==u&&(a=Di())!==u&&(s=Tc())!==u&&(i=fs())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=at(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function fs(){var t,e,n,o,a;return (t=ps())===u&&(t=function(){var r,t,e;r=Mu,(t=function(){var r,t,e,n,o;r=Mu,t=Mu,(e=Mi())!==u&&(n=Tc())!==u&&(o=Ui())!==u?t=e=[e,n,o]:(Mu=t,t=u);t!==u&&(Du=r,t=it(t));(r=t)===u&&(r=Ui());return r}())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(e=Ju())!==u&&Tc()!==u&&Ac()!==u?(Du=r,n=t,(o=e).parentheses=true,t=Xc(n,o),r=t):(Mu=r,r=u);var n,o;return r}())===u&&(t=Mu,(e=Mi())===u&&(e=Mu,33===r.charCodeAt(Mu)?(n="!",Mu++):(n=u,0===Hu&&Yu(st)),n!==u?(o=Mu,Hu++,61===r.charCodeAt(Mu)?(a="=",Mu++):(a=u,0===Hu&&Yu(Jr)),Hu--,a===u?o=void 0:(Mu=o,o=u),o!==u?e=n=[n,o]:(Mu=e,e=u)):(Mu=e,e=u)),e!==u&&(n=Tc())!==u&&(o=fs())!==u?(Du=t,t=e=Xc("NOT",o)):(Mu=t,t=u)),t}function ps(){var t,e,n,o,a;return t=Mu,(e=hs())!==u&&Tc()!==u?((n=function(){var t;(t=function(){var r,t,e,n,o,a,s;r=Mu,t=[],e=Mu,(n=Tc())!==u&&(o=bs())!==u&&(a=Tc())!==u&&(s=hs())!==u?e=n=[n,o,a,s]:(Mu=e,e=u);if(e!==u)for(;e!==u;)t.push(e),e=Mu,(n=Tc())!==u&&(o=bs())!==u&&(a=Tc())!==u&&(s=hs())!==u?e=n=[n,o,a,s]:(Mu=e,e=u);else t=u;t!==u&&(Du=r,t={type:"arithmetic",tail:t});return r=t}())===u&&(t=ds())===u&&(t=function(){var r,t,e,n;r=Mu,(t=function(){var r,t,e,n,o;r=Mu,t=Mu,(e=Mi())!==u&&(n=Tc())!==u&&(o=Ii())!==u?t=e=[e,n,o]:(Mu=t,t=u);t!==u&&(Du=r,t=it(t));(r=t)===u&&(r=Ii());return r}())!==u&&Tc()!==u&&(e=hs())!==u&&Tc()!==u&&Di()!==u&&Tc()!==u&&(n=hs())!==u?(Du=r,r=t={op:t,right:{type:"expr_list",value:[e,n]}}):(Mu=r,r=u);return r}())===u&&(t=function(){var r,t,e,n,o;r=Mu,(t=Oi())!==u&&(e=Tc())!==u&&(n=hs())!==u?(Du=r,r=t={op:"IS",right:n}):(Mu=r,r=u);r===u&&(r=Mu,t=Mu,(e=Oi())!==u&&(n=Tc())!==u&&(o=Mi())!==u?t=e=[e,n,o]:(Mu=t,t=u),t!==u&&(e=Tc())!==u&&(n=hs())!==u?(Du=r,t=function(r){return {op:"IS NOT",right:r}}(n),r=t):(Mu=r,r=u));return r}())===u&&(t=ys())===u&&(t=function(){var t,e,n,o;t=Mu,(e=function(){var t,e,n;t=Mu,(e=Mi())===u&&(e=null);e!==u&&Tc()!==u?((n=function(){var t,e,n,o;t=Mu,"regexp"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Pn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="REGEXP"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(n=function(){var t,e,n,o;t=Mu,"rlike"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Dn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="RLIKE"):(Mu=t,t=u)):(Mu=t,t=u);return t}()),n!==u?(Du=t,a=n,t=e=(o=e)?`${o} ${a}`:a):(Mu=t,t=u)):(Mu=t,t=u);var o,a;return t}())!==u&&Tc()!==u?("binary"===r.substr(Mu,6).toLowerCase()?(n=r.substr(Mu,6),Mu+=6):(n=u,0===Hu&&Yu(Dr)),n===u&&(n=null),n!==u&&Tc()!==u?((o=Bs())===u&&(o=Ys())===u&&(o=Es()),o!==u?(Du=t,a=e,t=e={op:(s=n)?`${a} ${s}`:a,right:o}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);var a,s;t===u&&(t=Mu,"glob"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(ht)),e!==u&&Tc()!==u&&(n=Ys())!==u?(Du=t,e=function(r){return {op:"GLOB",right:r}}(n),t=e):(Mu=t,t=u));return t}());return t}())===u&&(n=null),n!==u?(Du=t,o=e,t=e=null===(a=n)?o:"arithmetic"===a.type?Jc(o,a.tail):Kc(a.op,o,a.right)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Ys())===u&&(t=Es()),t}function bs(){var t;return ">="===r.substr(Mu,2)?(t=">=",Mu+=2):(t=u,0===Hu&&Yu(ct)),t===u&&(62===r.charCodeAt(Mu)?(t=">",Mu++):(t=u,0===Hu&&Yu(lt)),t===u&&("<="===r.substr(Mu,2)?(t="<=",Mu+=2):(t=u,0===Hu&&Yu(ft)),t===u&&("<>"===r.substr(Mu,2)?(t="<>",Mu+=2):(t=u,0===Hu&&Yu(pt)),t===u&&(60===r.charCodeAt(Mu)?(t="<",Mu++):(t=u,0===Hu&&Yu(bt)),t===u&&("=="===r.substr(Mu,2)?(t="==",Mu+=2):(t=u,0===Hu&&Yu(vt)),t===u&&(61===r.charCodeAt(Mu)?(t="=",Mu++):(t=u,0===Hu&&Yu(Jr)),t===u&&("!="===r.substr(Mu,2)?(t="!=",Mu+=2):(t=u,0===Hu&&Yu(yt))))))))),t}function vs(){var r,t,e,n,o;return r=Mu,t=Mu,(e=Mi())!==u&&(n=Tc())!==u&&(o=Ni())!==u?t=e=[e,n,o]:(Mu=t,t=u),t!==u&&(Du=r,t=it(t)),(r=t)===u&&(r=Ni()),r}function ys(){var t,e,n,o,a,s,i;return t=Mu,(e=function(){var r,t,e,n,o;return r=Mu,t=Mu,(e=Mi())!==u&&(n=Tc())!==u&&(o=Ri())!==u?t=e=[e,n,o]:(Mu=t,t=u),t!==u&&(Du=r,t=it(t)),(r=t)===u&&(r=Ri()),r}())!==u&&Tc()!==u?((n=ps())===u&&(n=qs()),n!==u&&Tc()!==u?((o=function(){var t,e,n;return t=Mu,"escape"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(dt)),e!==u&&Tc()!==u&&(n=Ys())!==u?(Du=t,t=e={type:"ESCAPE",value:n}):(Mu=t,t=u),t}())===u&&(o=null),o!==u?(Du=t,a=e,s=n,(i=o)&&(s.escape=i),t=e={op:a,right:s}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t}function ds(){var r,t,e,n;return r=Mu,(t=vs())!==u&&Tc()!==u&&(e=Cc())!==u&&Tc()!==u&&(n=es())!==u&&Tc()!==u&&Ac()!==u?(Du=r,r=t={op:t,right:n}):(Mu=r,r=u),r===u&&(r=Mu,(t=vs())!==u&&Tc()!==u?((e=Gc())===u&&(e=Ys())===u&&(e=Bs()),e!==u?(Du=r,r=t=function(r,t){return {op:r,right:t}}(t,e)):(Mu=r,r=u)):(Mu=r,r=u)),r}function hs(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=ws())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=ms())!==u&&(s=Tc())!==u&&(i=ws())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=ms())!==u&&(s=Tc())!==u&&(i=ws())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=function(r,t){if(t&&t.length&&"column_ref"===r.type&&"*"===r.column)throw new Error(JSON.stringify({message:"args could not be star column in additive expr",...Qc()}));return Jc(r,t)}(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function ms(){var t;return 43===r.charCodeAt(Mu)?(t="+",Mu++):(t=u,0===Hu&&Yu(mt)),t===u&&(45===r.charCodeAt(Mu)?(t="-",Mu++):(t=u,0===Hu&&Yu(wt))),t}function ws(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=As())!==u){for(e=[],n=Mu,(o=Tc())!==u?((a=Ls())===u&&(a=_c()),a!==u&&(s=Tc())!==u&&(i=As())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u?((a=Ls())===u&&(a=_c()),a!==u&&(s=Tc())!==u&&(i=As())!==u?n=o=[o,a,s,i]:(Mu=n,n=u)):(Mu=n,n=u);e!==u?(Du=r,r=t=Jc(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Ls(){var t;return 42===r.charCodeAt(Mu)?(t="*",Mu++):(t=u,0===Hu&&Yu(Lt)),t===u&&(47===r.charCodeAt(Mu)?(t="/",Mu++):(t=u,0===Hu&&Yu(Ct)),t===u&&(37===r.charCodeAt(Mu)?(t="%",Mu++):(t=u,0===Hu&&Yu(At)),t===u&&("||"===r.substr(Mu,2)?(t="||",Mu+=2):(t=u,0===Hu&&Yu(Et)),t===u&&(38===r.charCodeAt(Mu)?(t="&",Mu++):(t=u,0===Hu&&Yu(gt)),t===u&&(">>"===r.substr(Mu,2)?(t=">>",Mu+=2):(t=u,0===Hu&&Yu(jt)),t===u&&("<<"===r.substr(Mu,2)?(t="<<",Mu+=2):(t=u,0===Hu&&Yu(_t)),t===u&&(94===r.charCodeAt(Mu)?(t="^",Mu++):(t=u,0===Hu&&Yu(Tt)),t===u&&(124===r.charCodeAt(Mu)?(t="|",Mu++):(t=u,0===Hu&&Yu(St)))))))))),t}function Cs(){var t,e,n,o;return (t=function(){var t,e,n,o,a,s,i;t=Mu,(e=Bi())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=is())!==u&&Tc()!==u&&hi()!==u&&Tc()!==u&&(o=Wc())!==u&&Tc()!==u&&(a=Ac())!==u?(Du=t,c=n,l=o,e={type:"cast",keyword:e.toLowerCase(),expr:c,symbol:"as",target:[l]},t=e):(Mu=t,t=u);var c,l;t===u&&(t=Mu,(e=Bi())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=is())!==u&&Tc()!==u&&hi()!==u&&Tc()!==u&&(o=Yi())!==u&&Tc()!==u&&(a=Cc())!==u&&Tc()!==u&&(s=zs())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u&&(i=Ac())!==u?(Du=t,e=function(r,t,e){return {type:"cast",keyword:r.toLowerCase(),expr:t,symbol:"as",target:[{dataType:"DECIMAL("+e+")"}]}}(e,n,s),t=e):(Mu=t,t=u),t===u&&(t=Mu,(e=Bi())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=is())!==u&&Tc()!==u&&hi()!==u&&Tc()!==u&&(o=Yi())!==u&&Tc()!==u&&(a=Cc())!==u&&Tc()!==u&&(s=zs())!==u&&Tc()!==u&&wc()!==u&&Tc()!==u&&(i=zs())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u&&Ac()!==u?(Du=t,e=function(r,t,e,n){return {type:"cast",keyword:r.toLowerCase(),expr:t,symbol:"as",target:[{dataType:"DECIMAL("+e+", "+n+")"}]}}(e,n,s,i),t=e):(Mu=t,t=u),t===u&&(t=Mu,(e=Bi())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=is())!==u&&Tc()!==u&&hi()!==u&&Tc()!==u&&(o=function(){var t;(t=function(){var t,e,n,o;t=Mu,"signed"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(uo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SIGNED"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=Vi());return t}())!==u&&Tc()!==u?((a=Xi())===u&&(a=null),a!==u&&Tc()!==u&&(s=Ac())!==u?(Du=t,e=function(r,t,e,n){return {type:"cast",keyword:r.toLowerCase(),expr:t,symbol:"as",target:[{dataType:e+(n?" "+n:"")}]}}(e,n,o,a),t=e):(Mu=t,t=u)):(Mu=t,t=u))));return t}())===u&&(t=qs())===u&&(t=ns())===u&&(t=function(){var t;(t=function(){var t,e,n,o;t=Mu,(e=function(){var t,e,n,o;t=Mu,"count"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Bn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="COUNT"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(e=function(){var t,e,n,o;t=Mu,"group_concat"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(Gn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="GROUP_CONCAT"):(Mu=t,t=u)):(Mu=t,t=u);return t}());e!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=function(){var t,e,n,o,a,s,i,c,l,f;t=Mu,(e=function(){var t,e;t=Mu,42===r.charCodeAt(Mu)?(e="*",Mu++):(e=u,0===Hu&&Yu(Lt));e!==u&&(Du=t,e={type:"star",value:"*"});return t=e}())!==u&&(Du=t,e={expr:e});if((t=e)===u){if(t=Mu,(e=ki())===u&&(e=null),e!==u)if(Tc()!==u)if((n=Cc())!==u)if(Tc()!==u)if((o=is())!==u)if(Tc()!==u)if(Ac()!==u){for(a=[],s=Mu,(i=Tc())!==u?((c=Di())===u&&(c=Pi()),c!==u&&(l=Tc())!==u&&(f=is())!==u?s=i=[i,c,l,f]:(Mu=s,s=u)):(Mu=s,s=u);s!==u;)a.push(s),s=Mu,(i=Tc())!==u?((c=Di())===u&&(c=Pi()),c!==u&&(l=Tc())!==u&&(f=is())!==u?s=i=[i,c,l,f]:(Mu=s,s=u)):(Mu=s,s=u);a!==u&&(s=Tc())!==u?((i=qa())===u&&(i=null),i!==u?(Du=t,e=function(r,t,e,n){const o=e.length;let u=t;u.parentheses=true;for(let r=0;r<o;++r)u=Kc(e[r][1],u,e[r][3]);return {distinct:r,expr:u,orderby:n}}(e,o,a,i),t=e):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;t===u&&(t=Mu,(e=ki())===u&&(e=null),e!==u&&Tc()!==u&&(n=$a())!==u&&Tc()!==u?((o=qa())===u&&(o=null),o!==u?(Du=t,t=e={distinct:e,expr:n,orderby:o}):(Mu=t,t=u)):(Mu=t,t=u));}return t}())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((o=Hs())===u&&(o=null),o!==u?(Du=t,t=e={type:"aggr_func",name:e,args:n,over:o}):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=function(){var t;(t=function(){var t,e,n,o;t=Mu,"sum"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Yn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SUM"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"max"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(qn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MAX"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"min"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Wn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MIN"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"avg"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Vn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="AVG"):(Mu=t,t=u)):(Mu=t,t=u);return t}());return t}())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&(n=hs())!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((o=Hs())===u&&(o=null),o!==u?(Du=t,e={type:"aggr_func",name:e,args:{expr:n},over:o,...Qc()},t=e):(Mu=t,t=u)):(Mu=t,t=u);return t}());return t}())===u&&(t=Bs())===u&&(t=function(){var r,t,e,n,o,a,s,i;return r=Mu,Fi()!==u&&Tc()!==u&&(t=os())!==u&&Tc()!==u?((e=as())===u&&(e=null),e!==u&&Tc()!==u&&(n=Hi())!==u&&Tc()!==u?((o=Fi())===u&&(o=null),o!==u?(Du=r,s=t,(i=e)&&s.push(i),r={type:"case",expr:null,args:s}):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,Fi()!==u&&Tc()!==u&&(t=is())!==u&&Tc()!==u&&(e=os())!==u&&Tc()!==u?((n=as())===u&&(n=null),n!==u&&Tc()!==u&&(o=Hi())!==u&&Tc()!==u?((a=Fi())===u&&(a=null),a!==u?(Du=r,r=function(r,t,e){return e&&t.push(e),{type:"case",expr:r,args:t}}(t,e,n)):(Mu=r,r=u)):(Mu=r,r=u)):(Mu=r,r=u)),r}())===u&&(t=Es())===u&&(t=Fs())===u&&(t=Mu,Cc()!==u&&(e=Tc())!==u&&(n=cs())!==u&&Tc()!==u&&Ac()!==u?(Du=t,(o=n).parentheses=true,t=o):(Mu=t,t=u),t===u&&(t=Gc())===u&&(t=Mu,Tc()!==u?(63===r.charCodeAt(Mu)?(e="?",Mu++):(e=u,0===Hu&&Yu(xt)),e!==u?(Du=t,t={type:"origin",value:e}):(Mu=t,t=u)):(Mu=t,t=u))),t}function As(){var t,e,n,o,a;return (t=function(){var t,e,n,o,a,s,i,c;if(t=Mu,(e=Cs())!==u)if(Tc()!==u){for(n=[],o=Mu,(a=Tc())!==u?("?|"===r.substr(Mu,2)?(s="?|",Mu+=2):(s=u,0===Hu&&Yu(It)),s===u&&("?&"===r.substr(Mu,2)?(s="?&",Mu+=2):(s=u,0===Hu&&Yu(Nt)),s===u&&(63===r.charCodeAt(Mu)?(s="?",Mu++):(s=u,0===Hu&&Yu(xt)),s===u&&("#-"===r.substr(Mu,2)?(s="#-",Mu+=2):(s=u,0===Hu&&Yu(Ot)),s===u&&("#>>"===r.substr(Mu,3)?(s="#>>",Mu+=3):(s=u,0===Hu&&Yu(Rt)),s===u&&("#>"===r.substr(Mu,2)?(s="#>",Mu+=2):(s=u,0===Hu&&Yu(Ut)),s===u&&(s=jc())===u&&(s=gc())===u&&("@>"===r.substr(Mu,2)?(s="@>",Mu+=2):(s=u,0===Hu&&Yu(Mt)),s===u&&("<@"===r.substr(Mu,2)?(s="<@",Mu+=2):(s=u,0===Hu&&Yu(Dt))))))))),s!==u&&(i=Tc())!==u&&(c=Cs())!==u?o=a=[a,s,i,c]:(Mu=o,o=u)):(Mu=o,o=u);o!==u;)n.push(o),o=Mu,(a=Tc())!==u?("?|"===r.substr(Mu,2)?(s="?|",Mu+=2):(s=u,0===Hu&&Yu(It)),s===u&&("?&"===r.substr(Mu,2)?(s="?&",Mu+=2):(s=u,0===Hu&&Yu(Nt)),s===u&&(63===r.charCodeAt(Mu)?(s="?",Mu++):(s=u,0===Hu&&Yu(xt)),s===u&&("#-"===r.substr(Mu,2)?(s="#-",Mu+=2):(s=u,0===Hu&&Yu(Ot)),s===u&&("#>>"===r.substr(Mu,3)?(s="#>>",Mu+=3):(s=u,0===Hu&&Yu(Rt)),s===u&&("#>"===r.substr(Mu,2)?(s="#>",Mu+=2):(s=u,0===Hu&&Yu(Ut)),s===u&&(s=jc())===u&&(s=gc())===u&&("@>"===r.substr(Mu,2)?(s="@>",Mu+=2):(s=u,0===Hu&&Yu(Mt)),s===u&&("<@"===r.substr(Mu,2)?(s="<@",Mu+=2):(s=u,0===Hu&&Yu(Dt))))))))),s!==u&&(i=Tc())!==u&&(c=Cs())!==u?o=a=[a,s,i,c]:(Mu=o,o=u)):(Mu=o,o=u);n!==u?(Du=t,l=e,e=(f=n)&&0!==f.length?Jc(l,f):l,t=e):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;var l,f;return t}())===u&&(t=Mu,(e=function(){var t;33===r.charCodeAt(Mu)?(t="!",Mu++):(t=u,0===Hu&&Yu(st));t===u&&(45===r.charCodeAt(Mu)?(t="-",Mu++):(t=u,0===Hu&&Yu(wt)),t===u&&(43===r.charCodeAt(Mu)?(t="+",Mu++):(t=u,0===Hu&&Yu(mt)),t===u&&(126===r.charCodeAt(Mu)?(t="~",Mu++):(t=u,0===Hu&&Yu(kt)))));return t}())!==u?(n=Mu,(o=Tc())!==u&&(a=As())!==u?n=o=[o,a]:(Mu=n,n=u),n!==u?(Du=t,t=e=Xc(e,n[1])):(Mu=t,t=u)):(Mu=t,t=u)),t}function Es(){var r,t,e,n,o,a,s,i,c,l,f,p;return r=Mu,(t=_s())!==u&&(e=Tc())!==u&&(n=mc())!==u&&(o=Tc())!==u&&(a=Ns())!==u?(s=Mu,(i=Tc())!==u&&(c=sa())!==u?s=i=[i,c]:(Mu=s,s=u),s===u&&(s=null),s!==u?(Du=r,l=t,f=a,p=s,ol.add(`select::${l}::${f}`),r=t={type:"column_ref",table:l,column:f,collate:p&&p[1]}):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=Os())!==u?(e=Mu,(n=Tc())!==u&&(o=sa())!==u?e=n=[n,o]:(Mu=e,e=u),e===u&&(e=null),e!==u?(Du=r,r=t=function(r,t){return ol.add("select::null::"+r),{type:"column_ref",table:null,column:r,collate:t&&t[1]}}(t,e)):(Mu=r,r=u)):(Mu=r,r=u)),r}function gs(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Os())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Os())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Os())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=T(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function js(){var r,t;return r=Mu,(t=Us())!==u&&(Du=r,t={type:"default",value:t}),(r=t)===u&&(r=Ts()),r}function _s(){var r,t;return r=Mu,(t=Us())!==u?(Du=Mu,(Pt(t)?u:void 0)!==u?(Du=r,r=t=t):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=Ss())!==u&&(Du=r,t=t),r=t),r}function Ts(){var r;return (r=xs())===u&&(r=ks())===u&&(r=Is()),r}function Ss(){var r,t;return r=Mu,(t=xs())===u&&(t=ks())===u&&(t=Is()),t!==u&&(Du=r,t=t.value),r=t}function xs(){var t,e,n,o;if(t=Mu,34===r.charCodeAt(Mu)?(e='"',Mu++):(e=u,0===Hu&&Yu(Ft)),e!==u){if(n=[],$t.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Ht)),o!==u)for(;o!==u;)n.push(o),$t.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Ht));else n=u;n!==u?(34===r.charCodeAt(Mu)?(o='"',Mu++):(o=u,0===Hu&&Yu(Ft)),o!==u?(Du=t,t=e={type:"double_quote_string",value:n.join("")}):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;return t}function ks(){var t,e,n,o;if(t=Mu,39===r.charCodeAt(Mu)?(e="'",Mu++):(e=u,0===Hu&&Yu(_r)),e!==u){if(n=[],Bt.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Gt)),o!==u)for(;o!==u;)n.push(o),Bt.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Gt));else n=u;n!==u?(39===r.charCodeAt(Mu)?(o="'",Mu++):(o=u,0===Hu&&Yu(_r)),o!==u?(Du=t,t=e={type:"single_quote_string",value:n.join("")}):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;return t}function Is(){var t,e,n,o;if(t=Mu,96===r.charCodeAt(Mu)?(e="`",Mu++):(e=u,0===Hu&&Yu(qt)),e!==u){if(n=[],Wt.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Yt)),o!==u)for(;o!==u;)n.push(o),Wt.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(Yt));else n=u;n!==u?(96===r.charCodeAt(Mu)?(o="`",Mu++):(o=u,0===Hu&&Yu(qt)),o!==u?(Du=t,t=e={type:"backticks_quote_string",value:n.join("")}):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;return t}function Ns(){var r,t;return r=Mu,(t=Rs())!==u&&(Du=r,t=t),(r=t)===u&&(r=Ss()),r}function Os(){var r,t;return r=Mu,(t=Rs())!==u?(Du=Mu,(Pt(t)?u:void 0)!==u?(Du=r,r=t=t):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Ss()),r}function Rs(){var r,t,e,n;if(r=Mu,(t=Ms())!==u){for(e=[],n=Ps();n!==u;)e.push(n),n=Ps();e!==u?(Du=r,r=t=Vt(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Us(){var r,t,e,n;if(r=Mu,(t=Ms())!==u){for(e=[],n=Ds();n!==u;)e.push(n),n=Ds();e!==u?(Du=r,r=t=Vt(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Ms(){var t;return Qt.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(Xt)),t}function Ds(){var t;return Kt.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(zt)),t}function Ps(){var t;return Zt.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(Jt)),t}function Fs(){var t,e,n,o;return t=Mu,e=Mu,58===r.charCodeAt(Mu)?(n=":",Mu++):(n=u,0===Hu&&Yu(re)),n!==u&&(o=Us())!==u?e=n=[n,o]:(Mu=e,e=u),e!==u&&(Du=t,e={type:"param",value:e[1]}),t=e}function $s(){var r,t,e;return r=Mu,Ci()!==u&&Tc()!==u&&si()!==u&&Tc()!==u&&(t=ac())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u?((e=es())===u&&(e=null),e!==u&&Tc()!==u&&Ac()!==u?(Du=r,r={type:"on update",keyword:t,parentheses:true,expr:e}):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,Ci()!==u&&Tc()!==u&&si()!==u&&Tc()!==u&&(t=ac())!==u?(Du=r,r=function(r){return {type:"on update",keyword:r}}(t)):(Mu=r,r=u)),r}function Hs(){var t,e,n;return t=Mu,function(){var t,e,n,o;t=Mu,"over"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(hn));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}()!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u&&vi()!==u&&Tc()!==u&&_i()!==u&&Tc()!==u&&(e=Ta())!==u&&Tc()!==u?((n=qa())===u&&(n=null),n!==u&&Tc()!==u&&Ac()!==u?(Du=t,t={partitionby:e,orderby:n}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=$s()),t}function Bs(){var t,e,n,o,a;return t=Mu,(e=function(){var t;(t=Gs())===u&&(t=function(){var t,e,n,o;t=Mu,"current_user"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(Fo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CURRENT_USER"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"user"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(So));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="USER"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"session_user"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu($o));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SESSION_USER"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"system_user"===r.substr(Mu,11).toLowerCase()?(e=r.substr(Mu,11),Mu+=11):(e=u,0===Hu&&Yu(Ho));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SYSTEM_USER"):(Mu=t,t=u)):(Mu=t,t=u);return t}());return t}())!==u&&Tc()!==u&&(n=Cc())!==u&&Tc()!==u?((o=es())===u&&(o=null),o!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((a=Hs())===u&&(a=null),a!==u?(Du=t,t=e={type:"function",name:{name:[{type:"default",value:e}]},args:o||{type:"expr_list",value:[]},over:a,...Qc()}):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=Gs())!==u&&Tc()!==u?((n=$s())===u&&(n=null),n!==u?(Du=t,t=e={type:"function",name:{name:[{type:"origin",value:e}]},over:n,...Qc()}):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Mu,(e=$c())!==u&&Tc()!==u&&(n=Cc())!==u&&Tc()!==u?((o=cs())===u&&(o=null),o!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((a=Hs())===u&&(a=null),a!==u?(Du=t,t=e=function(r,t,e){return t&&"expr_list"!==t.type&&(t={type:"expr_list",value:[t]}),{type:"function",name:r,args:t||{type:"expr_list",value:[]},over:e,...Qc()}}(e,o,a)):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u))),t}function Gs(){var t;return (t=function(){var t,e,n,o;t=Mu,"current_date"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(xo));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CURRENT_DATE"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=function(){var t,e,n,o;t=Mu,"current_time"===r.substr(Mu,12).toLowerCase()?(e=r.substr(Mu,12),Mu+=12):(e=u,0===Hu&&Yu(Do));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CURRENT_TIME"):(Mu=t,t=u)):(Mu=t,t=u);return t}())===u&&(t=ac()),t}function qs(){var t,e,n,o,a,s,i,c,l;return t=Mu,"binary"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Dr)),e===u&&(e=null),e!==u&&Tc()!==u&&(n=Ys())!==u?(o=Mu,(a=Tc())!==u&&(s=sa())!==u?o=a=[a,s]:(Mu=o,o=u),o===u&&(o=null),o!==u?(Du=t,c=n,l=o,(i=e)&&(c.prefix=i.toLowerCase()),l&&(c.suffix={collate:l[1]}),t=e=c):(Mu=t,t=u)):(Mu=t,t=u),t===u&&(t=Ks())===u&&(t=function(){var t,e;t=Mu,(e=function(){var t,e,n,o;t=Mu,"true"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(He));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={type:"bool",value:true});(t=e)===u&&(t=Mu,(e=function(){var t,e,n,o;t=Mu,"false"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Ge));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={type:"bool",value:false}),t=e);return t}())===u&&(t=Ws())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,(e=oc())===u&&(e=ec())===u&&(e=uc())===u&&(e=nc());if(e!==u)if(Tc()!==u){if(n=Mu,39===r.charCodeAt(Mu)?(o="'",Mu++):(o=u,0===Hu&&Yu(_r)),o!==u){for(a=[],s=Qs();s!==u;)a.push(s),s=Qs();a!==u?(39===r.charCodeAt(Mu)?(s="'",Mu++):(s=u,0===Hu&&Yu(_r)),s!==u?n=o=[o,a,s]:(Mu=n,n=u)):(Mu=n,n=u);}else Mu=n,n=u;n!==u?(Du=t,e=se(e,n),t=e):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;if(t===u)if(t=Mu,(e=oc())===u&&(e=ec())===u&&(e=uc())===u&&(e=nc()),e!==u)if(Tc()!==u){if(n=Mu,34===r.charCodeAt(Mu)?(o='"',Mu++):(o=u,0===Hu&&Yu(Ft)),o!==u){for(a=[],s=Vs();s!==u;)a.push(s),s=Vs();a!==u?(34===r.charCodeAt(Mu)?(s='"',Mu++):(s=u,0===Hu&&Yu(Ft)),s!==u?n=o=[o,a,s]:(Mu=n,n=u)):(Mu=n,n=u);}else Mu=n,n=u;n!==u?(Du=t,e=se(e,n),t=e):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;return t}()),t}function Ws(){var t,e;return t=Mu,(e=function(){var t,e,n,o;t=Mu,"null"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Fe));e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u);return t}())!==u&&(Du=t,e={type:"null",value:null}),t=e}function Ys(){var t,e,n,o,a,s,i,c;if(t=Mu,"_binary"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(te)),e===u&&(e=null),e!==u)if((n=Tc())!==u)if("x"===r.substr(Mu,1).toLowerCase()?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ee)),o!==u){if(a=Mu,39===r.charCodeAt(Mu)?(s="'",Mu++):(s=u,0===Hu&&Yu(_r)),s!==u){for(i=[],ne.test(r.charAt(Mu))?(c=r.charAt(Mu),Mu++):(c=u,0===Hu&&Yu(oe));c!==u;)i.push(c),ne.test(r.charAt(Mu))?(c=r.charAt(Mu),Mu++):(c=u,0===Hu&&Yu(oe));i!==u?(39===r.charCodeAt(Mu)?(c="'",Mu++):(c=u,0===Hu&&Yu(_r)),c!==u?a=s=[s,i,c]:(Mu=a,a=u)):(Mu=a,a=u);}else Mu=a,a=u;a!==u?(Du=t,t=e={type:"hex_string",prefix:e,value:a[1].join("")}):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;if(t===u){if(t=Mu,"_binary"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(te)),e===u&&(e=null),e!==u)if((n=Tc())!==u)if("b"===r.substr(Mu,1).toLowerCase()?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ue)),o!==u){if(a=Mu,39===r.charCodeAt(Mu)?(s="'",Mu++):(s=u,0===Hu&&Yu(_r)),s!==u){for(i=[],ne.test(r.charAt(Mu))?(c=r.charAt(Mu),Mu++):(c=u,0===Hu&&Yu(oe));c!==u;)i.push(c),ne.test(r.charAt(Mu))?(c=r.charAt(Mu),Mu++):(c=u,0===Hu&&Yu(oe));i!==u?(39===r.charCodeAt(Mu)?(c="'",Mu++):(c=u,0===Hu&&Yu(_r)),c!==u?a=s=[s,i,c]:(Mu=a,a=u)):(Mu=a,a=u);}else Mu=a,a=u;a!==u?(Du=t,t=e=function(r,t,e){return {type:"bit_string",prefix:r,value:e[1].join("")}}(e,0,a)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;if(t===u){if(t=Mu,"_binary"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(te)),e===u&&(e=null),e!==u)if((n=Tc())!==u)if("0x"===r.substr(Mu,2)?(o="0x",Mu+=2):(o=u,0===Hu&&Yu(ae)),o!==u){for(a=[],ne.test(r.charAt(Mu))?(s=r.charAt(Mu),Mu++):(s=u,0===Hu&&Yu(oe));s!==u;)a.push(s),ne.test(r.charAt(Mu))?(s=r.charAt(Mu),Mu++):(s=u,0===Hu&&Yu(oe));a!==u?(Du=t,t=e=function(r,t,e){return {type:"full_hex_string",prefix:r,value:e.join("")}}(e,0,a)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;if(t===u){if(t=Mu,e=Mu,39===r.charCodeAt(Mu)?(n="'",Mu++):(n=u,0===Hu&&Yu(_r)),n!==u){for(o=[],a=Qs();a!==u;)o.push(a),a=Qs();o!==u?(39===r.charCodeAt(Mu)?(a="'",Mu++):(a=u,0===Hu&&Yu(_r)),a!==u?e=n=[n,o,a]:(Mu=e,e=u)):(Mu=e,e=u);}else Mu=e,e=u;if(e!==u&&(n=Tc())!==u?(o=Mu,Hu++,(a=mc())===u&&(a=Cc()),Hu--,a===u?o=void 0:(Mu=o,o=u),o!==u?(Du=t,t=e=function(r){return {type:"single_quote_string",value:r[1].join("")}}(e)):(Mu=t,t=u)):(Mu=t,t=u),t===u){if(t=Mu,e=Mu,34===r.charCodeAt(Mu)?(n='"',Mu++):(n=u,0===Hu&&Yu(Ft)),n!==u){for(o=[],a=Vs();a!==u;)o.push(a),a=Vs();o!==u?(34===r.charCodeAt(Mu)?(a='"',Mu++):(a=u,0===Hu&&Yu(Ft)),a!==u?e=n=[n,o,a]:(Mu=e,e=u)):(Mu=e,e=u);}else Mu=e,e=u;e!==u&&(n=Tc())!==u?(o=Mu,Hu++,(a=mc())===u&&(a=Cc()),Hu--,a===u?o=void 0:(Mu=o,o=u),o!==u?(Du=t,t=e=function(r){return {type:"double_quote_string",value:r[1].join("")}}(e)):(Mu=t,t=u)):(Mu=t,t=u);}}}}return t}function Vs(){var t;return ie.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(ce)),t===u&&(t=Xs()),t}function Qs(){var t;return le.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(fe)),t===u&&(t=Xs()),t}function Xs(){var t,e,n,o,a,s,i,c,l,f;return t=Mu,"\\'"===r.substr(Mu,2)?(e="\\'",Mu+=2):(e=u,0===Hu&&Yu(pe)),e!==u&&(Du=t,e="\\'"),(t=e)===u&&(t=Mu,'\\"'===r.substr(Mu,2)?(e='\\"',Mu+=2):(e=u,0===Hu&&Yu(be)),e!==u&&(Du=t,e='\\"'),(t=e)===u&&(t=Mu,"\\\\"===r.substr(Mu,2)?(e="\\\\",Mu+=2):(e=u,0===Hu&&Yu(ve)),e!==u&&(Du=t,e="\\\\"),(t=e)===u&&(t=Mu,"\\/"===r.substr(Mu,2)?(e="\\/",Mu+=2):(e=u,0===Hu&&Yu(ye)),e!==u&&(Du=t,e="\\/"),(t=e)===u&&(t=Mu,"\\b"===r.substr(Mu,2)?(e="\\b",Mu+=2):(e=u,0===Hu&&Yu(de)),e!==u&&(Du=t,e="\b"),(t=e)===u&&(t=Mu,"\\f"===r.substr(Mu,2)?(e="\\f",Mu+=2):(e=u,0===Hu&&Yu(he)),e!==u&&(Du=t,e="\f"),(t=e)===u&&(t=Mu,"\\n"===r.substr(Mu,2)?(e="\\n",Mu+=2):(e=u,0===Hu&&Yu(me)),e!==u&&(Du=t,e="\n"),(t=e)===u&&(t=Mu,"\\r"===r.substr(Mu,2)?(e="\\r",Mu+=2):(e=u,0===Hu&&Yu(we)),e!==u&&(Du=t,e="\r"),(t=e)===u&&(t=Mu,"\\t"===r.substr(Mu,2)?(e="\\t",Mu+=2):(e=u,0===Hu&&Yu(Le)),e!==u&&(Du=t,e="\t"),(t=e)===u&&(t=Mu,"\\u"===r.substr(Mu,2)?(e="\\u",Mu+=2):(e=u,0===Hu&&Yu(Ce)),e!==u&&(n=ei())!==u&&(o=ei())!==u&&(a=ei())!==u&&(s=ei())!==u?(Du=t,i=n,c=o,l=a,f=s,t=e=String.fromCharCode(parseInt("0x"+i+c+l+f))):(Mu=t,t=u),t===u&&(t=Mu,92===r.charCodeAt(Mu)?(e="\\",Mu++):(e=u,0===Hu&&Yu(Ae)),e!==u&&(Du=t,e="\\"),(t=e)===u&&(t=Mu,"''"===r.substr(Mu,2)?(e="''",Mu+=2):(e=u,0===Hu&&Yu(Ee)),e!==u&&(Du=t,e="''"),(t=e)===u&&(t=Mu,'""'===r.substr(Mu,2)?(e='""',Mu+=2):(e=u,0===Hu&&Yu(ge)),e!==u&&(Du=t,e='""'),(t=e)===u&&(t=Mu,"``"===r.substr(Mu,2)?(e="``",Mu+=2):(e=u,0===Hu&&Yu(je)),e!==u&&(Du=t,e="``"),t=e))))))))))))),t}function Ks(){var r,t,e;return r=Mu,(t=function(){var r,t,e,n;r=Mu,(t=zs())!==u&&(e=Zs())!==u&&(n=Js())!==u?(Du=r,r=t={type:"bigint",value:t+e+n}):(Mu=r,r=u);r===u&&(r=Mu,(t=zs())!==u&&(e=Zs())!==u?(Du=r,t=function(r,t){const e=r+t;if(zc(r))return {type:"bigint",value:e};const n=t.length>=1?t.length-1:0;return parseFloat(e).toFixed(n)}(t,e),r=t):(Mu=r,r=u),r===u&&(r=Mu,(t=zs())!==u&&(e=Js())!==u?(Du=r,t=function(r,t){return {type:"bigint",value:r+t}}(t,e),r=t):(Mu=r,r=u),r===u&&(r=Mu,(t=zs())!==u&&(Du=r,t=function(r){return zc(r)?{type:"bigint",value:r}:parseFloat(r)}(t)),r=t)));return r}())!==u&&(Du=r,t=(e=t)&&"bigint"===e.type?e:{type:"number",value:e}),r=t}function zs(){var t,e,n;return (t=ri())===u&&(t=ti())===u&&(t=Mu,45===r.charCodeAt(Mu)?(e="-",Mu++):(e=u,0===Hu&&Yu(wt)),e===u&&(43===r.charCodeAt(Mu)?(e="+",Mu++):(e=u,0===Hu&&Yu(mt))),e!==u&&(n=ri())!==u?(Du=t,t=e=e+n):(Mu=t,t=u),t===u&&(t=Mu,45===r.charCodeAt(Mu)?(e="-",Mu++):(e=u,0===Hu&&Yu(wt)),e===u&&(43===r.charCodeAt(Mu)?(e="+",Mu++):(e=u,0===Hu&&Yu(mt))),e!==u&&(n=ti())!==u?(Du=t,t=e=function(r,t){return r+t}(e,n)):(Mu=t,t=u))),t}function Zs(){var t,e,n,o;return t=Mu,46===r.charCodeAt(Mu)?(e=".",Mu++):(e=u,0===Hu&&Yu(Se)),e!==u?((n=ri())===u&&(n=null),n!==u?(Du=t,t=e=(o=n)?"."+o:""):(Mu=t,t=u)):(Mu=t,t=u),t}function Js(){var t,e,n;return t=Mu,(e=function(){var t,e,n;t=Mu,Oe.test(r.charAt(Mu))?(e=r.charAt(Mu),Mu++):(e=u,0===Hu&&Yu(Re));e!==u?(Ue.test(r.charAt(Mu))?(n=r.charAt(Mu),Mu++):(n=u,0===Hu&&Yu(Me)),n===u&&(n=null),n!==u?(Du=t,t=e=e+(null!==(o=n)?o:"")):(Mu=t,t=u)):(Mu=t,t=u);var o;return t}())!==u&&(n=ri())!==u?(Du=t,t=e=e+n):(Mu=t,t=u),t}function ri(){var r,t,e;if(r=Mu,t=[],(e=ti())!==u)for(;e!==u;)t.push(e),e=ti();else t=u;return t!==u&&(Du=r,t=t.join("")),r=t}function ti(){var t;return xe.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(ke)),t}function ei(){var t;return Ie.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(Ne)),t}function ni(){var t,e,n,o;return t=Mu,"default"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(M)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function oi(){var t,e,n,o;return t=Mu,"to"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(Be)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function ui(){var t,e,n,o;return t=Mu,"show"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(qe)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function ai(){var t,e,n,o;return t=Mu,"drop"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(We)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DROP"):(Mu=t,t=u)):(Mu=t,t=u),t}function si(){var t,e,n,o;return t=Mu,"update"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Xe)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function ii(){var t,e,n,o;return t=Mu,"create"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Ke)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function ci(){var t,e,n,o;return t=Mu,"temporary"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(ze)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function li(){var t,e,n,o;return t=Mu,"temp"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Ze)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function fi(){var t,e,n,o;return t=Mu,"delete"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Je)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function pi(){var t,e,n,o;return t=Mu,"insert"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(rn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function bi(){var t,e,n,o;return t=Mu,"rename"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(en)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function vi(){var t,e,n,o;return t=Mu,"partition"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(on)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="PARTITION"):(Mu=t,t=u)):(Mu=t,t=u),t}function yi(){var t,e,n,o;return t=Mu,"into"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(un)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function di(){var t,e,n,o;return t=Mu,"set"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(dr)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SET"):(Mu=t,t=u)):(Mu=t,t=u),t}function hi(){var t,e,n,o;return t=Mu,"as"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(B)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function mi(){var t,e,n,o;return t=Mu,"table"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(cn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TABLE"):(Mu=t,t=u)):(Mu=t,t=u),t}function wi(){var t,e,n,o;return t=Mu,"tables"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(ln)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TABLES"):(Mu=t,t=u)):(Mu=t,t=u),t}function Li(){var t,e,n,o;return t=Mu,"database"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(fn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DATABASE"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ci(){var t,e,n,o;return t=Mu,"on"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(d)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function Ai(){var t,e,n,o;return t=Mu,"join"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(yn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function Ei(){var t,e,n,o;return t=Mu,"values"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(wn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function gi(){var t,e,n,o;return t=Mu,"using"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Ln)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function ji(){var t,e,n,o;return t=Mu,"with"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Qr)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function _i(){var t,e,n,o;return t=Mu,"by"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(En)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function Ti(){var t,e,n,o;return t=Mu,"asc"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Sn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ASC"):(Mu=t,t=u)):(Mu=t,t=u),t}function Si(){var t,e,n,o;return t=Mu,"desc"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(xn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DESC"):(Mu=t,t=u)):(Mu=t,t=u),t}function xi(){var t,e,n,o;return t=Mu,"all"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(In)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ALL"):(Mu=t,t=u)):(Mu=t,t=u),t}function ki(){var t,e,n,o;return t=Mu,"distinct"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(Nn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DISTINCT"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ii(){var t,e,n,o;return t=Mu,"between"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(On)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="BETWEEN"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ni(){var t,e,n,o;return t=Mu,"in"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(Rn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="IN"):(Mu=t,t=u)):(Mu=t,t=u),t}function Oi(){var t,e,n,o;return t=Mu,"is"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(Un)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="IS"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ri(){var t,e,n,o;return t=Mu,"like"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Mn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="LIKE"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ui(){var t,e,n,o;return t=Mu,"exists"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Fn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="EXISTS"):(Mu=t,t=u)):(Mu=t,t=u),t}function Mi(){var t,e,n,o;return t=Mu,"not"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(nr)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="NOT"):(Mu=t,t=u)):(Mu=t,t=u),t}function Di(){var t,e,n,o;return t=Mu,"and"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu($n)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="AND"):(Mu=t,t=u)):(Mu=t,t=u),t}function Pi(){var t,e,n,o;return t=Mu,"or"===r.substr(Mu,2).toLowerCase()?(e=r.substr(Mu,2),Mu+=2):(e=u,0===Hu&&Yu(Hn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="OR"):(Mu=t,t=u)):(Mu=t,t=u),t}function Fi(){var t,e,n,o;return t=Mu,"case"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Xn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function $i(){var t,e,n,o;return t=Mu,"when"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Kn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function Hi(){var t,e,n,o;return t=Mu,"end"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(L)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?t=e=[e,n]:(Mu=t,t=u)):(Mu=t,t=u),t}function Bi(){var t,e,n,o;return t=Mu,"cast"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Jn)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CAST"):(Mu=t,t=u)):(Mu=t,t=u),t}function Gi(){var t,e,n,o;return t=Mu,"char"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(to)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CHAR"):(Mu=t,t=u)):(Mu=t,t=u),t}function qi(){var t,e,n,o;return t=Mu,"varchar"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(eo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="VARCHAR"):(Mu=t,t=u)):(Mu=t,t=u),t}function Wi(){var t,e,n,o;return t=Mu,"numeric"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(no)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="NUMERIC"):(Mu=t,t=u)):(Mu=t,t=u),t}function Yi(){var t,e,n,o;return t=Mu,"decimal"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(oo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DECIMAL"):(Mu=t,t=u)):(Mu=t,t=u),t}function Vi(){var t,e,n,o;return t=Mu,"unsigned"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(ao)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="UNSIGNED"):(Mu=t,t=u)):(Mu=t,t=u),t}function Qi(){var t,e,n,o;return t=Mu,"int"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(so)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="INT"):(Mu=t,t=u)):(Mu=t,t=u),t}function Xi(){var t,e,n,o;return t=Mu,"integer"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(co)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="INTEGER"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ki(){var t,e,n,o;return t=Mu,"smallint"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(fo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="SMALLINT"):(Mu=t,t=u)):(Mu=t,t=u),t}function zi(){var t,e,n,o;return t=Mu,"tinyint"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(po)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TINYINT"):(Mu=t,t=u)):(Mu=t,t=u),t}function Zi(){var t,e,n,o;return t=Mu,"bigint"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(mo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="BIGINT"):(Mu=t,t=u)):(Mu=t,t=u),t}function Ji(){var t,e,n,o;return t=Mu,"float"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(Lo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="FLOAT"):(Mu=t,t=u)):(Mu=t,t=u),t}function rc(){var t,e,n,o;return t=Mu,"double"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(Co)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DOUBLE"):(Mu=t,t=u)):(Mu=t,t=u),t}function tc(){var t,e,n,o;return t=Mu,"real"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Ao)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="REAL"):(Mu=t,t=u)):(Mu=t,t=u),t}function ec(){var t,e,n,o;return t=Mu,"date"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Eo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DATE"):(Mu=t,t=u)):(Mu=t,t=u),t}function nc(){var t,e,n,o;return t=Mu,"datetime"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(go)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="DATETIME"):(Mu=t,t=u)):(Mu=t,t=u),t}function oc(){var t,e,n,o;return t=Mu,"time"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(jo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TIME"):(Mu=t,t=u)):(Mu=t,t=u),t}function uc(){var t,e,n,o;return t=Mu,"timestamp"===r.substr(Mu,9).toLowerCase()?(e=r.substr(Mu,9),Mu+=9):(e=u,0===Hu&&Yu(_o)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TIMESTAMP"):(Mu=t,t=u)):(Mu=t,t=u),t}function ac(){var t,e,n,o;return t=Mu,"current_timestamp"===r.substr(Mu,17).toLowerCase()?(e=r.substr(Mu,17),Mu+=17):(e=u,0===Hu&&Yu(Po)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CURRENT_TIMESTAMP"):(Mu=t,t=u)):(Mu=t,t=u),t}function sc(){var t,e,n,o;return t=Mu,"view"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Yo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="VIEW"):(Mu=t,t=u)):(Mu=t,t=u),t}function ic(){var t;return 64===r.charCodeAt(Mu)?(t="@",Mu++):(t=u,0===Hu&&Yu(Vo)),t}function cc(){var t;return (t=function(){var t;return "@@"===r.substr(Mu,2)?(t="@@",Mu+=2):(t=u,0===Hu&&Yu(Qo)),t}())===u&&(t=ic())===u&&(t=function(){var t;return 36===r.charCodeAt(Mu)?(t="$",Mu++):(t=u,0===Hu&&Yu(Xo)),t}()),t}function lc(){var t;return 61===r.charCodeAt(Mu)?(t="=",Mu++):(t=u,0===Hu&&Yu(Jr)),t}function fc(){var t,e,n,o;return t=Mu,"add"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(Jo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ADD"):(Mu=t,t=u)):(Mu=t,t=u),t}function pc(){var t,e,n,o;return t=Mu,"column"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(ru)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="COLUMN"):(Mu=t,t=u)):(Mu=t,t=u),t}function bc(){var t,e,n,o;return t=Mu,"index"===r.substr(Mu,5).toLowerCase()?(e=r.substr(Mu,5),Mu+=5):(e=u,0===Hu&&Yu(tu)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="INDEX"):(Mu=t,t=u)):(Mu=t,t=u),t}function vc(){var t,e,n,o;return t=Mu,"key"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(I)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="KEY"):(Mu=t,t=u)):(Mu=t,t=u),t}function yc(){var t,e,n,o;return t=Mu,"unique"===r.substr(Mu,6).toLowerCase()?(e=r.substr(Mu,6),Mu+=6):(e=u,0===Hu&&Yu(k)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="UNIQUE"):(Mu=t,t=u)):(Mu=t,t=u),t}function dc(){var t,e,n,o;return t=Mu,"comment"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(uu)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="COMMENT"):(Mu=t,t=u)):(Mu=t,t=u),t}function hc(){var t,e,n,o;return t=Mu,"constraint"===r.substr(Mu,10).toLowerCase()?(e=r.substr(Mu,10),Mu+=10):(e=u,0===Hu&&Yu(au)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="CONSTRAINT"):(Mu=t,t=u)):(Mu=t,t=u),t}function mc(){var t;return 46===r.charCodeAt(Mu)?(t=".",Mu++):(t=u,0===Hu&&Yu(Se)),t}function wc(){var t;return 44===r.charCodeAt(Mu)?(t=",",Mu++):(t=u,0===Hu&&Yu(vu)),t}function Lc(){var t;return 42===r.charCodeAt(Mu)?(t="*",Mu++):(t=u,0===Hu&&Yu(Lt)),t}function Cc(){var t;return 40===r.charCodeAt(Mu)?(t="(",Mu++):(t=u,0===Hu&&Yu(qr)),t}function Ac(){var t;return 41===r.charCodeAt(Mu)?(t=")",Mu++):(t=u,0===Hu&&Yu(Wr)),t}function Ec(){var t;return 59===r.charCodeAt(Mu)?(t=";",Mu++):(t=u,0===Hu&&Yu(hu)),t}function gc(){var t;return "->"===r.substr(Mu,2)?(t="->",Mu+=2):(t=u,0===Hu&&Yu(mu)),t}function jc(){var t;return "->>"===r.substr(Mu,3)?(t="->>",Mu+=3):(t=u,0===Hu&&Yu(wu)),t}function _c(){var t;return (t=function(){var t;return "||"===r.substr(Mu,2)?(t="||",Mu+=2):(t=u,0===Hu&&Yu(Et)),t}())===u&&(t=function(){var t;return "&&"===r.substr(Mu,2)?(t="&&",Mu+=2):(t=u,0===Hu&&Yu(Lu)),t}()),t}function Tc(){var r,t;for(r=[],(t=Nc())===u&&(t=xc());t!==u;)r.push(t),(t=Nc())===u&&(t=xc());return r}function Sc(){var r,t;if(r=[],(t=Nc())===u&&(t=xc()),t!==u)for(;t!==u;)r.push(t),(t=Nc())===u&&(t=xc());else r=u;return r}function xc(){var t;return (t=function(){var t,e,n,o,a,s;t=Mu,"/*"===r.substr(Mu,2)?(e="/*",Mu+=2):(e=u,0===Hu&&Yu(Cu));if(e!==u){for(n=[],o=Mu,a=Mu,Hu++,"*/"===r.substr(Mu,2)?(s="*/",Mu+=2):(s=u,0===Hu&&Yu(Au)),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,a=Mu,Hu++,"*/"===r.substr(Mu,2)?(s="*/",Mu+=2):(s=u,0===Hu&&Yu(Au)),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);n!==u?("*/"===r.substr(Mu,2)?(o="*/",Mu+=2):(o=u,0===Hu&&Yu(Au)),o!==u?t=e=[e,n,o]:(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;return t}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,"--"===r.substr(Mu,2)?(e="--",Mu+=2):(e=u,0===Hu&&Yu(Eu));if(e!==u){for(n=[],o=Mu,a=Mu,Hu++,s=Oc(),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,a=Mu,Hu++,s=Oc(),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);n!==u?t=e=[e,n]:(Mu=t,t=u);}else Mu=t,t=u;return t}())===u&&(t=function(){var t,e,n,o,a,s;t=Mu,35===r.charCodeAt(Mu)?(e="#",Mu++):(e=u,0===Hu&&Yu(gu));if(e!==u){for(n=[],o=Mu,a=Mu,Hu++,s=Oc(),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);o!==u;)n.push(o),o=Mu,a=Mu,Hu++,s=Oc(),Hu--,s===u?a=void 0:(Mu=a,a=u),a!==u&&(s=Ic())!==u?o=a=[a,s]:(Mu=o,o=u);n!==u?t=e=[e,n]:(Mu=t,t=u);}else Mu=t,t=u;return t}()),t}function kc(){var r,t,e,n,o,a,s;return r=Mu,(t=dc())!==u&&Tc()!==u?((e=lc())===u&&(e=null),e!==u&&Tc()!==u&&(n=Ys())!==u?(Du=r,a=e,s=n,r=t={type:(o=t).toLowerCase(),keyword:o.toLowerCase(),symbol:a,value:s}):(Mu=r,r=u)):(Mu=r,r=u),r}function Ic(){var t;return r.length>Mu?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(ju)),t}function Nc(){var t;return _u.test(r.charAt(Mu))?(t=r.charAt(Mu),Mu++):(t=u,0===Hu&&Yu(Tu)),t}function Oc(){var t,e;if((t=function(){var t,e;t=Mu,Hu++,r.length>Mu?(e=r.charAt(Mu),Mu++):(e=u,0===Hu&&Yu(ju));Hu--,e===u?t=void 0:(Mu=t,t=u);return t}())===u)if(t=[],_e.test(r.charAt(Mu))?(e=r.charAt(Mu),Mu++):(e=u,0===Hu&&Yu(Te)),e!==u)for(;e!==u;)t.push(e),_e.test(r.charAt(Mu))?(e=r.charAt(Mu),Mu++):(e=u,0===Hu&&Yu(Te));else t=u;return t}function Rc(){var t,e;return t=Mu,Du=Mu,el=[],(void 0)!==u&&Tc()!==u?((e=Uc())===u&&(e=function(){var t,e;t=Mu,function(){var t;return "return"===r.substr(Mu,6).toLowerCase()?(t=r.substr(Mu,6),Mu+=6):(t=u,0===Hu&&Yu(Ko)),t}()!==u&&Tc()!==u&&(e=Mc())!==u?(Du=t,t={type:"return",expr:e}):(Mu=t,t=u);return t}()),e!==u?(Du=t,t={stmt:e,vars:el}):(Mu=t,t=u)):(Mu=t,t=u),t}function Uc(){var t,e,n,o;return t=Mu,(e=Gc())===u&&(e=qc()),e!==u&&Tc()!==u?((n=function(){var t;return ":="===r.substr(Mu,2)?(t=":=",Mu+=2):(t=u,0===Hu&&Yu(zo)),t}())===u&&(n=lc()),n!==u&&Tc()!==u&&(o=Mc())!==u?(Du=t,t=e={type:"assign",left:e,symbol:n,right:o}):(Mu=t,t=u)):(Mu=t,t=u),t}function Mc(){var t;return (t=Ca())===u&&(t=function(){var r,t,e,n,o;r=Mu,(t=Gc())!==u&&Tc()!==u&&(e=Pa())!==u&&Tc()!==u&&(n=Gc())!==u&&Tc()!==u&&(o=Ha())!==u?(Du=r,r=t={type:"join",ltable:t,rtable:n,op:e,on:o}):(Mu=r,r=u);return r}())===u&&(t=Dc())===u&&(t=function(){var t,e;t=Mu,function(){var t;return 91===r.charCodeAt(Mu)?(t="[",Mu++):(t=u,0===Hu&&Yu(yu)),t}()!==u&&Tc()!==u&&(e=Bc())!==u&&Tc()!==u&&function(){var t;return 93===r.charCodeAt(Mu)?(t="]",Mu++):(t=u,0===Hu&&Yu(du)),t}()!==u?(Du=t,t={type:"array",value:e}):(Mu=t,t=u);return t}()),t}function Dc(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Pc())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=ms())!==u&&(s=Tc())!==u&&(i=Pc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=ms())!==u&&(s=Tc())!==u&&(i=Pc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=at(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Pc(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Fc())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=Ls())!==u&&(s=Tc())!==u&&(i=Fc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=Ls())!==u&&(s=Tc())!==u&&(i=Fc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=at(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Fc(){var r,t,e;return (r=qs())===u&&(r=Gc())===u&&(r=Hc())===u&&(r=Fs())===u&&(r=Mu,Cc()!==u&&Tc()!==u&&(t=Dc())!==u&&Tc()!==u&&Ac()!==u?(Du=r,(e=t).parentheses=true,r=e):(Mu=r,r=u)),r}function $c(){var r,t,e,n,o,a,s;return r=Mu,(t=js())!==u?(e=Mu,(n=Tc())!==u&&(o=mc())!==u&&(a=Tc())!==u&&(s=js())!==u?e=n=[n,o,a,s]:(Mu=e,e=u),e===u&&(e=null),e!==u?(Du=r,r=t=function(r,t){const e={name:[r]};return null!==t&&(e.schema=r,e.name=[t[3]]),e}(t,e)):(Mu=r,r=u)):(Mu=r,r=u),r}function Hc(){var r,t,e;return r=Mu,(t=$c())!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u?((e=Bc())===u&&(e=null),e!==u&&Tc()!==u&&Ac()!==u?(Du=r,r=t={type:"function",name:t,args:{type:"expr_list",value:e},...Qc()}):(Mu=r,r=u)):(Mu=r,r=u),r===u&&(r=Mu,(t=$c())!==u&&(Du=r,t=function(r){return {type:"function",name:r,args:null,...Qc()}}(t)),r=t),r}function Bc(){var r,t,e,n,o,a,s,i;if(r=Mu,(t=Fc())!==u){for(e=[],n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Fc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);n!==u;)e.push(n),n=Mu,(o=Tc())!==u&&(a=wc())!==u&&(s=Tc())!==u&&(i=Fc())!==u?n=o=[o,a,s,i]:(Mu=n,n=u);e!==u?(Du=r,r=t=T(t,e)):(Mu=r,r=u);}else Mu=r,r=u;return r}function Gc(){var r,t,e,n,o;return r=Mu,(t=cc())!==u&&(e=qc())!==u?(Du=r,n=t,o=e,r=t={type:"var",...o,prefix:n}):(Mu=r,r=u),r}function qc(){var t,e,n,o,a;return t=Mu,(e=Us())!==u&&(n=function(){var t,e,n,o,a;t=Mu,e=[],n=Mu,46===r.charCodeAt(Mu)?(o=".",Mu++):(o=u,0===Hu&&Yu(Se));o!==u&&(a=Us())!==u?n=o=[o,a]:(Mu=n,n=u);for(;n!==u;)e.push(n),n=Mu,46===r.charCodeAt(Mu)?(o=".",Mu++):(o=u,0===Hu&&Yu(Se)),o!==u&&(a=Us())!==u?n=o=[o,a]:(Mu=n,n=u);e!==u&&(Du=t,e=function(r){const t=[];for(let e=0;e<r.length;e++)t.push(r[e][1]);return t}(e));return t=e}())!==u?(Du=t,o=e,a=n,el.push(o),t=e={type:"var",name:o,members:a,prefix:null}):(Mu=t,t=u),t===u&&(t=Mu,(e=Ks())!==u&&(Du=t,e={type:"var",name:e.value,members:[],quoted:null,prefix:null}),t=e),t}function Wc(){var t;return (t=function(){var t,e,n,o;t=Mu,(e=Gi())===u&&(e=qi());if(e!==u)if(Tc()!==u)if(Cc()!==u)if(Tc()!==u){if(n=[],xe.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ke)),o!==u)for(;o!==u;)n.push(o),xe.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ke));else n=u;n!==u&&(o=Tc())!==u&&Ac()!==u?(Du=t,e={dataType:e,length:parseInt(n.join(""),10),parentheses:true},t=e):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;t===u&&(t=Mu,(e=Gi())!==u&&(Du=t,e=Ou(e)),(t=e)===u&&(t=Mu,(e=qi())!==u&&(Du=t,e=Ou(e)),t=e));return t}())===u&&(t=function(){var t,e,n,o,a,s,i,c,l,f,p,b;t=Mu,(e=Wi())===u&&(e=Yi())===u&&(e=Qi())===u&&(e=Xi())===u&&(e=Ki())===u&&(e=zi())===u&&(e=Zi())===u&&(e=Ji())===u&&(e=rc())===u&&(e=function(){var t,e,n,o;return t=Mu,"bit"===r.substr(Mu,3).toLowerCase()?(e=r.substr(Mu,3),Mu+=3):(e=u,0===Hu&&Yu(ro)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="BIT"):(Mu=t,t=u)):(Mu=t,t=u),t}())===u&&(e=tc());if(e!==u)if((n=Tc())!==u)if((o=Cc())!==u)if((a=Tc())!==u){if(s=[],xe.test(r.charAt(Mu))?(i=r.charAt(Mu),Mu++):(i=u,0===Hu&&Yu(ke)),i!==u)for(;i!==u;)s.push(i),xe.test(r.charAt(Mu))?(i=r.charAt(Mu),Mu++):(i=u,0===Hu&&Yu(ke));else s=u;if(s!==u)if((i=Tc())!==u){if(c=Mu,(l=wc())!==u)if((f=Tc())!==u){if(p=[],xe.test(r.charAt(Mu))?(b=r.charAt(Mu),Mu++):(b=u,0===Hu&&Yu(ke)),b!==u)for(;b!==u;)p.push(b),xe.test(r.charAt(Mu))?(b=r.charAt(Mu),Mu++):(b=u,0===Hu&&Yu(ke));else p=u;p!==u?c=l=[l,f,p]:(Mu=c,c=u);}else Mu=c,c=u;else Mu=c,c=u;c===u&&(c=null),c!==u&&(l=Tc())!==u&&(f=Ac())!==u&&(p=Tc())!==u?((b=Yc())===u&&(b=null),b!==u?(Du=t,v=c,y=b,e={dataType:e,length:parseInt(s.join(""),10),scale:v&&parseInt(v[2].join(""),10),parentheses:true,suffix:y},t=e):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;else Mu=t,t=u;}else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;else Mu=t,t=u;var v,y;if(t===u){if(t=Mu,(e=Wi())===u&&(e=Yi())===u&&(e=Qi())===u&&(e=Xi())===u&&(e=Ki())===u&&(e=zi())===u&&(e=Zi())===u&&(e=Ji())===u&&(e=rc())===u&&(e=tc()),e!==u){if(n=[],xe.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ke)),o!==u)for(;o!==u;)n.push(o),xe.test(r.charAt(Mu))?(o=r.charAt(Mu),Mu++):(o=u,0===Hu&&Yu(ke));else n=u;n!==u&&(o=Tc())!==u?((a=Yc())===u&&(a=null),a!==u?(Du=t,e=function(r,t,e){return {dataType:r,length:parseInt(t.join(""),10),suffix:e}}(e,n,a),t=e):(Mu=t,t=u)):(Mu=t,t=u);}else Mu=t,t=u;t===u&&(t=Mu,(e=Wi())===u&&(e=Yi())===u&&(e=Qi())===u&&(e=Xi())===u&&(e=Ki())===u&&(e=zi())===u&&(e=Zi())===u&&(e=Ji())===u&&(e=rc())===u&&(e=tc()),e!==u&&(n=Tc())!==u?((o=Yc())===u&&(o=null),o!==u&&(a=Tc())!==u?(Du=t,e=function(r,t){return {dataType:r,suffix:t}}(e,o),t=e):(Mu=t,t=u)):(Mu=t,t=u));}return t}())===u&&(t=function(){var t,e,n,o;t=Mu,(e=ec())===u&&(e=nc())===u&&(e=oc())===u&&(e=uc());e!==u&&Tc()!==u&&Cc()!==u&&Tc()!==u?(Ru.test(r.charAt(Mu))?(n=r.charAt(Mu),Mu++):(n=u,0===Hu&&Yu(Uu)),n!==u&&Tc()!==u&&Ac()!==u&&Tc()!==u?((o=Yc())===u&&(o=null),o!==u?(Du=t,e={dataType:e,length:parseInt(n,10),parentheses:true},t=e):(Mu=t,t=u)):(Mu=t,t=u)):(Mu=t,t=u);t===u&&(t=Mu,(e=ec())===u&&(e=nc())===u&&(e=oc())===u&&(e=uc()),e!==u&&(Du=t,e=Ou(e)),t=e);return t}())===u&&(t=function(){var t,e;t=Mu,(e=function(){var t,e,n,o;return t=Mu,"json"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(lo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="JSON"):(Mu=t,t=u)):(Mu=t,t=u),t}())!==u&&(Du=t,e=Ou(e));return t=e}())===u&&(t=function(){var t,e;t=Mu,(e=function(){var t,e,n,o;return t=Mu,"tinytext"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(bo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TINYTEXT"):(Mu=t,t=u)):(Mu=t,t=u),t}())===u&&(e=function(){var t,e,n,o;return t=Mu,"text"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(vo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="TEXT"):(Mu=t,t=u)):(Mu=t,t=u),t}())===u&&(e=function(){var t,e,n,o;return t=Mu,"mediumtext"===r.substr(Mu,10).toLowerCase()?(e=r.substr(Mu,10),Mu+=10):(e=u,0===Hu&&Yu(yo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="MEDIUMTEXT"):(Mu=t,t=u)):(Mu=t,t=u),t}())===u&&(e=function(){var t,e,n,o;return t=Mu,"longtext"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(ho)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="LONGTEXT"):(Mu=t,t=u)):(Mu=t,t=u),t}());e!==u&&(Du=t,e={dataType:e});return t=e}())===u&&(t=function(){var t,e,n;t=Mu,(e=function(){var t,e,n,o;return t=Mu,"enum"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(wo)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ENUM"):(Mu=t,t=u)):(Mu=t,t=u),t}())!==u&&Tc()!==u&&(n=ts())!==u?(Du=t,o=e,(a=n).parentheses=true,t=e={dataType:o,expr:a}):(Mu=t,t=u);var o,a;return t}())===u&&(t=function(){var t,e;t=Mu,"boolean"===r.substr(Mu,7).toLowerCase()?(e=r.substr(Mu,7),Mu+=7):(e=u,0===Hu&&Yu(Nu));e!==u&&(Du=t,e={dataType:"BOOLEAN"});return t=e}())===u&&(t=function(){var t,e;t=Mu,"blob"===r.substr(Mu,4).toLowerCase()?(e=r.substr(Mu,4),Mu+=4):(e=u,0===Hu&&Yu(Su));e===u&&("tinyblob"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(xu)),e===u&&("mediumblob"===r.substr(Mu,10).toLowerCase()?(e=r.substr(Mu,10),Mu+=10):(e=u,0===Hu&&Yu(ku)),e===u&&("longblob"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(Iu)))));e!==u&&(Du=t,e={dataType:e.toUpperCase()});return t=e}()),t}function Yc(){var t,e,n;return t=Mu,(e=Vi())===u&&(e=null),e!==u&&Tc()!==u?((n=function(){var t,e,n,o;return t=Mu,"zerofill"===r.substr(Mu,8).toLowerCase()?(e=r.substr(Mu,8),Mu+=8):(e=u,0===Hu&&Yu(io)),e!==u?(n=Mu,Hu++,o=Ms(),Hu--,o===u?n=void 0:(Mu=n,n=u),n!==u?(Du=t,t=e="ZEROFILL"):(Mu=t,t=u)):(Mu=t,t=u),t}())===u&&(n=null),n!==u?(Du=t,t=e=function(r,t){const e=[];return r&&e.push(r),t&&e.push(t),e}(e,n)):(Mu=t,t=u)):(Mu=t,t=u),t}const Vc={ALTER:true,ALL:true,ADD:true,AND:true,AS:true,ASC:true,BETWEEN:true,BY:true,CALL:true,CASE:true,CREATE:true,CONTAINS:true,COUNT:true,CURRENT_DATE:true,CURRENT_TIME:true,CURRENT_TIMESTAMP:true,CURRENT_USER:true,DELETE:true,DESC:true,DISTINCT:true,DROP:true,ELSE:true,END:true,EXISTS:true,EXPLAIN:true,FALSE:true,FROM:true,FULL:true,GENERATED:true,GROUP:true,HAVING:true,IN:true,INNER:true,INSERT:true,INTO:true,IS:true,JOIN:true,LEFT:true,LIKE:true,LIMIT:true,LOW_PRIORITY:true,NOT:true,NULL:true,ON:true,OR:true,ORDER:true,OUTER:true,RECURSIVE:true,RENAME:true,READ:true,RIGHT:true,SELECT:true,SESSION_USER:true,SET:true,SHOW:true,SYSTEM_USER:true,TABLE:true,THEN:true,TRUE:true,TRUNCATE:true,UNION:true,UPDATE:true,USING:true,VALUES:true,WITH:true,WHEN:true,WHERE:true,WRITE:true,GLOBAL:true,SESSION:true,LOCAL:true,PERSIST:true,PERSIST_ONLY:true};function Qc(){return t.includeLocations?{loc:Wu(Du,Mu)}:{}}function Xc(r,t){return {type:"unary_expr",operator:r,expr:t}}function Kc(r,t,e){return {type:"binary_expr",operator:r,left:t,right:e}}function zc(r){const t=n(Number.MAX_SAFE_INTEGER);return !(n(r)<t)}function Zc(r,t,e=3){const n=[r];for(let r=0;r<t.length;r++)delete t[r][e].tableList,delete t[r][e].columnList,n.push(t[r][e]);return n}function Jc(r,t){let e=r;for(let r=0;r<t.length;r++)e=Kc(t[r][1],e,t[r][3]);return e}function rl(r){const t=ul[r];return t||(r||null)}function tl(r){const t=new Set;for(let e of r.keys()){const r=e.split("::");if(!r){t.add(e);break}r&&r[1]&&(r[1]=rl(r[1])),t.add(r.join("::"));}return Array.from(t)}let el=[];const nl=new Set,ol=new Set,ul={};if((e=s())!==u&&Mu===r.length)return e;throw e!==u&&Mu<r.length&&Yu({type:"end"}),Vu($u,Fu<r.length?r.charAt(Fu):null,Fu<r.length?Wu(Fu,Fu+1):Wu(Fu,Fu))}};},function(r,t,e){r.exports=e(3);},function(r,t){r.exports=requireBigInteger();},function(r,t,e){e.r(t),e.d(t,"Parser",(function(){return qt})),e.d(t,"util",(function(){return n}));var n={};function o(r){return (o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}e.r(n),e.d(n,"arrayStructTypeToSQL",(function(){return g})),e.d(n,"autoIncrementToSQL",(function(){return x})),e.d(n,"columnOrderListToSQL",(function(){return k})),e.d(n,"commonKeywordArgsToSQL",(function(){return S})),e.d(n,"commonOptionConnector",(function(){return s})),e.d(n,"connector",(function(){return i})),e.d(n,"commonTypeValue",(function(){return L})),e.d(n,"commentToSQL",(function(){return j})),e.d(n,"createBinaryExpr",(function(){return l})),e.d(n,"createValueExpr",(function(){return c})),e.d(n,"dataTypeToSQL",(function(){return E})),e.d(n,"DEFAULT_OPT",(function(){return u})),e.d(n,"escape",(function(){return f})),e.d(n,"literalToSQL",(function(){return w})),e.d(n,"columnIdentifierToSql",(function(){return y})),e.d(n,"getParserOpt",(function(){return p})),e.d(n,"identifierToSql",(function(){return d})),e.d(n,"onPartitionsToSQL",(function(){return A})),e.d(n,"replaceParams",(function(){return C})),e.d(n,"returningToSQL",(function(){return T})),e.d(n,"hasVal",(function(){return m})),e.d(n,"setParserOpt",(function(){return b})),e.d(n,"toUpper",(function(){return h})),e.d(n,"topToSQL",(function(){return v})),e.d(n,"triggerEventToSQL",(function(){return _}));var u={database:"sqlite",type:"table",trimQuery:true,parseOptions:{includeLocations:false}},a=u;function s(r,t,e){if(e)return r?"".concat(r.toUpperCase()," ").concat(t(e)):t(e)}function i(r,t){if(t)return "".concat(r.toUpperCase()," ").concat(t)}function c(r){var t=o(r);if(Array.isArray(r))return {type:"expr_list",value:r.map(c)};if(null===r)return {type:"null",value:null};switch(t){case "boolean":return {type:"bool",value:r};case "string":return {type:"string",value:r};case "number":return {type:"number",value:r};default:throw new Error('Cannot convert value "'.concat(t,'" to SQL'))}}function l(r,t,e){var n={operator:r,type:"binary_expr"};return n.left=t.type?t:c(t),"BETWEEN"===r||"NOT BETWEEN"===r?(n.right={type:"expr_list",value:[c(e[0]),c(e[1])]},n):(n.right=e.type?e:c(e),n)}function f(r){return r}function p(){return a}function b(r){a=r;}function v(r){if(r){var t=r.value,e=r.percent,n=r.parentheses?"(".concat(t,")"):t,o="TOP ".concat(n);return e?"".concat(o," ").concat(e.toUpperCase()):o}}function y(r){var t=p().database;if(r)switch(t&&t.toLowerCase()){case "athena":case "db2":case "postgresql":case "redshift":case "snowflake":case "noql":case "trino":case "sqlite":return '"'.concat(r,'"');case "transactsql":return "[".concat(r,"]");case "mysql":case "mariadb":case "bigquery":default:return "`".concat(r,"`")}}function d(r,t,e){if(true===t)return "'".concat(r,"'");if(r){if("*"===r)return r;if(null!=e)return "".concat(e).concat(r).concat(e);var n=p().database;switch(n&&n.toLowerCase()){case "mysql":case "mariadb":return "`".concat(r,"`");case "athena":case "postgresql":case "redshift":case "snowflake":case "trino":case "noql":case "sqlite":return '"'.concat(r,'"');case "transactsql":return "[".concat(r,"]");case "bigquery":case "db2":return r;default:return "`".concat(r,"`")}}}function h(r){if(r)return r.toUpperCase()}function m(r){return r}function w(r){if(r){var t=r.prefix,e=r.type,n=r.parentheses,u=r.suffix,a=r.value,s="object"===o(r)?a:r;switch(e){case "backticks_quote_string":s="`".concat(a,"`");break;case "string":s="'".concat(a,"'");break;case "regex_string":s='r"'.concat(a,'"');break;case "hex_string":s="X'".concat(a,"'");break;case "full_hex_string":s="0x".concat(a);break;case "natural_string":s="N'".concat(a,"'");break;case "bit_string":s="b'".concat(a,"'");break;case "double_quote_string":s='"'.concat(a,'"');break;case "single_quote_string":s="'".concat(a,"'");break;case "boolean":case "bool":s=a?"TRUE":"FALSE";break;case "null":s="NULL";break;case "star":s="*";break;case "param":s="".concat(t||":").concat(a),t=null;break;case "origin":s=a.toUpperCase();break;case "date":case "datetime":case "time":case "timestamp":s="".concat(e.toUpperCase()," '").concat(a,"'");break;case "var_string":s="N'".concat(a,"'");break;case "unicode_string":s="U&'".concat(a,"'");}var i=[];return t&&i.push(h(t)),i.push(s),u&&("string"==typeof u&&i.push(u),"object"===o(u)&&(u.collate?i.push(bt(u.collate)):i.push(w(u)))),s=i.join(" "),n?"(".concat(s,")"):s}}function L(r){if(!r)return [];var t=r.type,e=r.symbol,n=r.value;return [t.toUpperCase(),e,"string"==typeof n?n.toUpperCase():w(n)].filter(m)}function C(r,t){return function r(t,e){return Object.keys(t).filter((function(r){var e=t[r];return Array.isArray(e)||"object"===o(e)&&null!==e})).forEach((function(n){var u=t[n];if("object"!==o(u)||"param"!==u.type)return r(u,e);if(void 0===e[u.value])throw new Error("no value for parameter :".concat(u.value," found"));return t[n]=c(e[u.value]),null})),t}(JSON.parse(JSON.stringify(r)),t)}function A(r){var t=r.type,e=r.partitions;return [h(t),"(".concat(e.map((function(r){if("range"!==r.type)return w(r);var t=r.start,e=r.end,n=r.symbol;return "".concat(w(t)," ").concat(h(n)," ").concat(w(e))})).join(", "),")")].join(" ")}function E(r){var t=r.schema,e=r.dataType,n=r.length,o=r.parentheses,u=r.scale,a=r.suffix,s="";null!=n&&(s=u?"".concat(n,", ").concat(u):n),o&&(s="(".concat(s,")")),a&&a.length&&(s+=" ".concat(a.join(" ")));var i=t?"".concat(t,"."):"";return "".concat(i).concat(e).concat(s)}function g(r){if(r){var t=r.dataType,e=r.definition,n=r.anglebracket,o=h(t);if("ARRAY"!==o&&"STRUCT"!==o)return o;var u=e&&e.map((function(r){return [r.field_name,g(r.field_type)].filter(m).join(" ")})).join(", ");return n?"".concat(o,"<").concat(u,">"):"".concat(o," ").concat(u)}}function j(r){if(r){var t=[],e=r.keyword,n=r.symbol,o=r.value;return t.push(e.toUpperCase()),n&&t.push(n),t.push(w(o)),t.join(" ")}}function _(r){return r.map((function(r){var t=r.keyword,e=r.args,n=[h(t)];if(e){var o=e.keyword,u=e.columns;n.push(h(o),u.map(Et).join(", "));}return n.join(" ")})).join(" OR ")}function T(r){return r?["RETURNING",r.columns.map(kt).filter(m).join(", ")].join(" "):""}function S(r){return r?[h(r.keyword),h(r.args)]:[]}function x(r){if(r){if("string"==typeof r){var t=p().database;switch(t&&t.toLowerCase()){case "sqlite":return "AUTOINCREMENT";default:return "AUTO_INCREMENT"}}var e=r.keyword,n=r.seed,o=r.increment,u=r.parentheses,a=h(e);return u&&(a+="(".concat(w(n),", ").concat(w(o),")")),a}}function k(r){if(r)return r.map(Tt).filter(m).join(", ")}function I(r){return function(r){if(Array.isArray(r))return N(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||function(r,t){if(r){if("string"==typeof r)return N(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?N(r,t):void 0}}(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function N(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function O(r){if(!r)return [];var t=r.keyword,e=r.type;return [t.toUpperCase(),h(e)]}function R(r){if(r){var t=r.type,e=r.expr,n=r.symbol,o=t.toUpperCase(),u=[];switch(u.push(o),o){case "KEY_BLOCK_SIZE":n&&u.push(n),u.push(w(e));break;case "BTREE":case "HASH":u.length=0,u.push.apply(u,I(O(r)));break;case "WITH PARSER":u.push(e);break;case "VISIBLE":case "INVISIBLE":break;case "COMMENT":u.shift(),u.push(j(r));break;case "DATA_COMPRESSION":u.push(n,h(e.value),A(e.on));break;default:u.push(n,w(e));}return u.filter(m).join(" ")}}function U(r){return r?r.map(R):[]}function M(r){var t=r.constraint_type,e=r.index_type,n=r.index_options,o=void 0===n?[]:n,u=r.definition,a=r.on,s=r.with,i=[];if(i.push.apply(i,I(O(e))),u&&u.length){var c="CHECK"===h(t)?"(".concat(lt(u[0]),")"):"(".concat(u.map((function(r){return lt(r)})).join(", "),")");i.push(c);}return i.push(U(o).join(" ")),s&&i.push("WITH (".concat(U(s).join(", "),")")),a&&i.push("ON [".concat(a,"]")),i}function D(r){var t=r.operator||r.op,e=lt(r.right),n=false;if(Array.isArray(e)){switch(t){case "=":t="IN";break;case "!=":t="NOT IN";break;case "BETWEEN":case "NOT BETWEEN":n=true,e="".concat(e[0]," AND ").concat(e[1]);}n||(e="(".concat(e.join(", "),")"));}var o=r.right.escape||{},u=Array.isArray(r.left)?r.left.map(lt).join(", "):lt(r.left),a=bt(r.collate),s=[u,t,e,h(o.type),lt(o.value)].filter(m).join("."===t?"":" "),i=r.parentheses?"(".concat(s,")"):s;return a&&(i="".concat(i," ").concat(a)),i}function P(r){var t=r.name,e=r.type;switch(e){case "table":case "view":var n=[d(t.db),d(t.table)].filter(m).join(".");return "".concat(h(e)," ").concat(n);case "column":return "COLUMN ".concat(Et(t));default:return "".concat(h(e)," ").concat(w(t))}}function F(r){var t=r.keyword,e=r.expr;return [h(t),w(e)].filter(m).join(" ")}function $(r){return function(r){if(Array.isArray(r))return H(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||function(r,t){if(r){if("string"==typeof r)return H(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?H(r,t):void 0}}(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function H(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function B(r){return r?[r.prefix.map(w).join(" "),lt(r.value),r.suffix.map(w).join(" ")]:[]}function G(r){return r?r.fetch||r.offset?(e=(t=r).fetch,n=t.offset,[].concat($(B(n)),$(B(e))).filter(m).join(" ")):function(r){var t=r.seperator,e=r.value;return 1===e.length&&"offset"===t?i("OFFSET",lt(e[0])):i("LIMIT",e.map(lt).join("".concat("offset"===t?" ":"").concat(h(t)," ")))}(r):"";var t,e,n;}function q(r){if(r&&0!==r.length){var t=r[0].recursive?"RECURSIVE ":"",e=r.map((function(r){var t=r.name,e=r.stmt,n=r.columns,o=Array.isArray(n)?"(".concat(n.map(Et).join(", "),")"):"",u=s("values"===e.type?"VALUES":"",lt,e);return "".concat("default"===t.type?d(t.value):w(t)).concat(o," AS (").concat(u,")")})).join(", ");return "WITH ".concat(t).concat(e)}}function W(r){if(r&&r.position){var t=r.keyword,e=r.expr,n=[],o=h(t);switch(o){case "VAR":n.push(e.map(ct).join(", "));break;default:n.push(o,"string"==typeof e?d(e):lt(e));}return n.filter(m).join(" ")}}function Y(r){var t=r.as_struct_val,e=r.columns,n=r.collate,o=r.distinct,u=r.for,a=r.from,c=r.for_sys_time_as_of,l=void 0===c?{}:c,f=r.locking_read,p=r.groupby,b=r.having,y=r.into,d=void 0===y?{}:y,L=r.isolation,C=r.limit,A=r.options,E=r.orderby,g=r.parentheses_symbol,j=r.qualify,_=r.top,T=r.window,S=r.with,x=r.where,k=[q(S),"SELECT",h(t)];Array.isArray(A)&&k.push(A.join(" ")),k.push(function(r){if(r){if("string"==typeof r)return r;var t=r.type,e=r.columns,n=[h(t)];return e&&n.push("(".concat(e.map(lt).join(", "),")")),n.filter(m).join(" ")}}(o),v(_),Nt(e,a));var I=d.position,N="";I&&(N=s("INTO",W,d)),"column"===I&&k.push(N),k.push(s("FROM",Cr,a)),"from"===I&&k.push(N);var O=l||{},R=O.keyword,U=O.expr;k.push(s(R,lt,U)),k.push(s("WHERE",lt,x)),p&&(k.push(i("GROUP BY",ft(p.columns).join(", "))),k.push(ft(p.modifiers).join(", "))),k.push(s("HAVING",lt,b)),k.push(s("QUALIFY",lt,j)),k.push(s("WINDOW",lt,T)),k.push(pt(E,"order by")),k.push(bt(n)),k.push(G(C)),L&&k.push(s(L.keyword,w,L.expr)),k.push(h(f)),"end"===I&&k.push(N),k.push(function(r){if(r){var t=r.expr,e=r.keyword,n=[h(r.type),h(e)];return t?"".concat(n.join(" "),"(").concat(lt(t),")"):n.join(" ")}}(u));var M=k.filter(m).join(" ");return g?"(".concat(M,")"):M}function V(r,t){var e="undefined"!=typeof Symbol&&r[Symbol.iterator]||r["@@iterator"];if(!e){if(Array.isArray(r)||(e=function(r,t){if(r){if("string"==typeof r)return Q(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?Q(r,t):void 0}}(r))||t){e&&(r=e);var n=0,o=function(){};return {s:o,n:function(){return n>=r.length?{done:true}:{done:false,value:r[n++]}},e:function(r){throw r},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var u,a=true,s=false;return {s:function(){e=e.call(r);},n:function(){var r=e.next();return a=r.done,r},e:function(r){s=true,u=r;},f:function(){try{a||null==e.return||e.return();}finally{if(s)throw u}}}}function Q(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function X(r){if(!r||0===r.length)return "";var t,e=[],n=V(r);try{for(n.s();!(t=n.n()).done;){var o=t.value,u={},a=o.value;for(var s in o)"value"!==s&&"keyword"!==s&&(u[s]=o[s]);var i=[Et(u)],c="";a&&(c=lt(a),i.push("=",c)),e.push(i.filter(m).join(" "));}}catch(r){n.e(r);}finally{n.f();}return e.join(", ")}function K(r){var t=r.name,e=r.value;return ["@".concat(t),"=",lt(e)].filter(m).join(" ")}function z(r){if(!r)return "";var t=r.keyword,e=r.terminated,n=r.enclosed,o=r.escaped;return [h(t),w(e),w(n),w(o)].filter(m).join(" ")}function Z(r){if(!r)return "";var t=r.keyword,e=r.starting,n=r.terminated;return [h(t),w(e),w(n)].filter(m).join(" ")}function J(r){if(!r)return "";var t=r.count,e=r.suffix;return ["IGNORE",w(t),e].filter(m).join(" ")}function rr(r){if(!r)return "";var t=r.mode,e=r.local,n=r.file,o=r.replace_ignore,u=r.table,a=r.partition,i=r.character_set,c=r.column,l=r.fields,f=r.lines,p=r.set,b=r.ignore;return ["LOAD DATA",h(t),h(e),"INFILE",w(n),h(o),"INTO TABLE",Lr(u),sr(a),s("CHARACTER SET",w,i),z(l),Z(f),J(b),Nt(c),s("SET",X,p)].filter(m).join(" ")}function tr(r){var t=r.left,e=r.right,n=r.symbol,o=r.keyword;t.keyword=o;var u=lt(t),a=lt(e);return [u,h(n),a].filter(m).join(" ")}function er(r){var t,e,n,o,u=r.keyword,a=r.suffix,i="";switch(h(u)){case "BINLOG":e=(t=r).in,n=t.from,o=t.limit,i=[s("IN",w,e&&e.right),s("FROM",Cr,n),G(o)].filter(m).join(" ");break;case "CHARACTER":case "COLLATION":i=function(r){var t=r.expr;if(t)return "LIKE"===h(t.op)?s("LIKE",w,t.right):s("WHERE",lt,t)}(r);break;case "COLUMNS":case "INDEXES":case "INDEX":i=s("FROM",Cr,r.from);break;case "GRANTS":i=function(r){var t=r.for;if(t){var e=t.user,n=t.host,o=t.role_list,u="'".concat(e,"'");return n&&(u+="@'".concat(n,"'")),["FOR",u,o&&"USING",o&&o.map((function(r){return "'".concat(r,"'")})).join(", ")].filter(m).join(" ")}}(r);break;case "CREATE":i=s("",Lr,r[a]);break;case "VAR":i=ct(r.var),u="";}return ["SHOW",h(u),h(a),i].filter(m).join(" ")}var nr={alter:function(r){var t=r.keyword;switch(void 0===t?"table":t){case "aggregate":return function(r){var t=r.args,e=r.expr,n=r.keyword,o=r.name,u=r.type,a=t.expr,s=t.orderby;return [h(u),h(n),[[d(o.schema),d(o.name)].filter(m).join("."),"(".concat(a.map(nt).join(", ")).concat(s?[" ORDER","BY",s.map(nt).join(", ")].join(" "):"",")")].filter(m).join(""),et(e)].filter(m).join(" ")}(r);case "table":return function(r){var t=r.type,e=r.table,n=r.if_exists,o=r.prefix,u=r.expr,a=void 0===u?[]:u,s=h(t),i=Cr(e),c=a.map(lt);return [s,"TABLE",h(n),w(o),i,c.join(", ")].filter(m).join(" ")}(r);case "schema":return function(r){var t=r.expr,e=r.keyword,n=r.schema;return [h(r.type),h(e),d(n),et(t)].filter(m).join(" ")}(r);case "sequence":return function(r){var t=r.type,e=r.keyword,n=r.sequence,o=r.if_exists,u=r.expr,a=void 0===u?[]:u,s=h(t),i=Cr(n),c=a.map(Xr);return [s,h(e),h(o),i,c.join(", ")].filter(m).join(" ")}(r);case "domain":case "type":return function(r){var t=r.expr,e=r.keyword,n=r.name;return [h(r.type),h(e),[d(n.schema),d(n.name)].filter(m).join("."),et(t)].filter(m).join(" ")}(r);case "function":return function(r){var t=r.args,e=r.expr,n=r.keyword,o=r.name;return [h(r.type),h(n),[[d(o.schema),d(o.name)].filter(m).join("."),t&&"(".concat(t.expr?t.expr.map(nt).join(", "):"",")")].filter(m).join(""),et(e)].filter(m).join(" ")}(r);case "view":return function(r){var t=r.type,e=r.columns,n=r.attributes,o=r.select,u=r.view,a=r.with,s=h(t),i=Lr(u),c=[s,"VIEW",i];e&&c.push("(".concat(e.map(Et).join(", "),")"));n&&c.push("WITH ".concat(n.map(h).join(", ")));c.push("AS",Y(o)),a&&c.push(h(a));return c.filter(m).join(" ")}(r)}},analyze:function(r){var t=r.type,e=r.table;return [h(t),Lr(e)].join(" ")},attach:function(r){var t=r.type,e=r.database,n=r.expr,o=r.as,u=r.schema;return [h(t),h(e),lt(n),h(o),d(u)].filter(m).join(" ")},create:function(r){var t=r.keyword,e="";switch(t.toLowerCase()){case "aggregate":e=function(r){var t=r.type,e=r.replace,n=r.keyword,o=r.name,u=r.args,a=r.options,s=[h(t),h(e),h(n)],i=[d(o.schema),o.name].filter(m).join("."),c="".concat(u.expr.map(nt).join(", ")).concat(u.orderby?[" ORDER","BY",u.orderby.map(nt).join(", ")].join(" "):"");return s.push("".concat(i,"(").concat(c,")"),"(".concat(a.map(rt).join(", "),")")),s.filter(m).join(" ")}(r);break;case "table":e=function(r){var t=r.type,e=r.keyword,n=r.table,o=r.like,u=r.as,a=r.temporary,s=r.if_not_exists,i=r.create_definitions,c=r.table_options,l=r.ignore_replace,f=r.replace,b=r.partition_of,v=r.query_expr,y=r.unlogged,d=r.with,L=[h(t),h(f),h(a),h(y),h(e),h(s),Cr(n)];if(o){var C=o.type,A=Cr(o.table);return L.push(h(C),A),L.filter(m).join(" ")}if(b)return L.concat([zr(b)]).filter(m).join(" ");i&&L.push("(".concat(i.map(Xr).join(", "),")"));if(c){var E=p().database,g=E&&"sqlite"===E.toLowerCase()?", ":" ";L.push(c.map(Ar).join(g));}if(d){var j=d.map((function(r){return [w(r.keyword),h(r.symbol),w(r.value)].join(" ")})).join(", ");L.push("WITH (".concat(j,")"));}L.push(h(l),h(u)),v&&L.push(or(v));return L.filter(m).join(" ")}(r);break;case "trigger":e="constraint"===r.resource?function(r){var t=r.constraint,e=r.constraint_kw,n=r.deferrable,o=r.events,u=r.execute,a=r.for_each,s=r.from,i=r.location,c=r.keyword,l=r.or,f=r.type,p=r.table,b=r.when,v=[h(f),h(l),h(e),h(c),d(t),h(i)],y=_(o);v.push(y,"ON",Lr(p)),s&&v.push("FROM",Lr(s));v.push.apply(v,Yr(S(n)).concat(Yr(S(a)))),b&&v.push(h(b.type),lt(b.cond));return v.push(h(u.keyword),Wr(u.expr)),v.filter(m).join(" ")}(r):function(r){var t=r.definer,e=r.for_each,n=r.keyword,o=r.execute,u=r.type,a=r.table,i=r.if_not_exists,c=r.temporary,l=r.trigger,f=r.events,p=r.order,b=r.time,v=r.when,y=[h(u),h(c),lt(t),h(n),h(i),Lr(l),h(b),f.map((function(r){var t=[h(r.keyword)],e=r.args;return e&&t.push(h(e.keyword),e.columns.map(Et).join(", ")),t.join(" ")})),"ON",Lr(a),h(e&&e.keyword),h(e&&e.args),p&&"".concat(h(p.keyword)," ").concat(d(p.trigger)),s("WHEN",lt,v),h(o.prefix)];switch(o.type){case "set":y.push(s("SET",X,o.expr));break;case "multiple":y.push(ur(o.expr.ast));}return y.push(h(o.suffix)),y.filter(m).join(" ")}(r);break;case "extension":e=function(r){var t=r.extension,e=r.from,n=r.if_not_exists,o=r.keyword,u=r.schema,a=r.type,i=r.with,c=r.version;return [h(a),h(o),h(n),w(t),h(i),s("SCHEMA",w,u),s("VERSION",w,c),s("FROM",w,e)].filter(m).join(" ")}(r);break;case "function":e=function(r){var t=r.type,e=r.replace,n=r.keyword,o=r.name,u=r.args,a=r.returns,s=r.options,i=r.last,c=[h(t),h(e),h(n)],l=[w(o.schema),o.name.map(w).join(".")].filter(m).join("."),f=u.map(nt).filter(m).join(", ");return c.push("".concat(l,"(").concat(f,")"),function(r){var t=r.type,e=r.keyword,n=r.expr;return [h(t),h(e),Array.isArray(n)?"(".concat(n.map(St).join(", "),")"):Zr(n)].filter(m).join(" ")}(a),s.map(Jr).join(" "),i),c.filter(m).join(" ")}(r);break;case "index":e=function(r){var t=r.concurrently,e=r.filestream_on,n=r.keyword,o=r.if_not_exists,u=r.include,a=r.index_columns,i=r.index_type,c=r.index_using,l=r.index,f=r.on,p=r.index_options,b=r.algorithm_option,v=r.lock_option,y=r.on_kw,L=r.table,C=r.tablespace,A=r.type,E=r.where,g=r.with,j=r.with_before_where,_=g&&"WITH (".concat(U(g).join(", "),")"),T=u&&"".concat(h(u.keyword)," (").concat(u.columns.map((function(r){return "string"==typeof r?d(r):lt(r)})).join(", "),")"),S=l;l&&(S="string"==typeof l?d(l):[d(l.schema),d(l.name)].filter(m).join("."));var x=[h(A),h(i),h(n),h(o),h(t),S,h(y),Lr(L)].concat(Yr(O(c)),["(".concat(k(a),")"),T,U(p).join(" "),et(b),et(v),s("TABLESPACE",w,C)]);j?x.push(_,s("WHERE",lt,E)):x.push(s("WHERE",lt,E),_);return x.push(s("ON",lt,f),s("FILESTREAM_ON",w,e)),x.filter(m).join(" ")}(r);break;case "sequence":e=function(r){var t=r.type,e=r.keyword,n=r.sequence,o=r.temporary,u=r.if_not_exists,a=r.create_definitions,s=[h(t),h(o),h(e),h(u),Cr(n)];a&&s.push(a.map(Xr).join(" "));return s.filter(m).join(" ")}(r);break;case "database":case "schema":e=function(r){var t=r.type,e=r.keyword,n=r.replace,o=r.if_not_exists,u=r.create_definitions,a=r[e],s=a.db,i=a.schema,c=[w(s),i.map(w).join(".")].filter(m).join("."),l=[h(t),h(n),h(e),h(o),c];u&&l.push(u.map(Ar).join(" "));return l.filter(m).join(" ")}(r);break;case "view":e=function(r){var t=r.algorithm,e=r.columns,n=r.definer,o=r.if_not_exists,u=r.keyword,a=r.recursive,s=r.replace,i=r.select,c=r.sql_security,l=r.temporary,f=r.type,p=r.view,b=r.with,v=r.with_options,w=p.db,C=p.schema,A=p.view,E=[d(w),d(C),d(A)].filter(m).join(".");return [h(f),h(s),h(l),h(a),t&&"ALGORITHM = ".concat(h(t)),lt(n),c&&"SQL SECURITY ".concat(h(c)),h(u),h(o),E,e&&"(".concat(e.map(y).join(", "),")"),v&&["WITH","(".concat(v.map((function(r){return L(r).join(" ")})).join(", "),")")].join(" "),"AS",or(i),h(b)].filter(m).join(" ")}(r);break;case "domain":e=function(r){var t=r.as,e=r.domain,n=r.type,o=r.keyword,u=r.target,a=r.create_definitions,s=[h(n),h(o),[d(e.schema),d(e.name)].filter(m).join("."),h(t),E(u)];if(a&&a.length>0){var i,c=[],l=function(r,t){var e="undefined"!=typeof Symbol&&r[Symbol.iterator]||r["@@iterator"];if(!e){if(Array.isArray(r)||(e=Vr(r))||t){e&&(r=e);var n=0,o=function(){};return {s:o,n:function(){return n>=r.length?{done:true}:{done:false,value:r[n++]}},e:function(r){throw r},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var u,a=true,s=false;return {s:function(){e=e.call(r);},n:function(){var r=e.next();return a=r.done,r},e:function(r){s=true,u=r;},f:function(){try{a||null==e.return||e.return();}finally{if(s)throw u}}}}(a);try{for(l.s();!(i=l.n()).done;){var f=i.value,p=f.type;switch(p){case "collate":c.push(lt(f));break;case "default":c.push(h(p),lt(f.value));break;case "constraint":c.push(Pr(f));}}}catch(r){l.e(r);}finally{l.f();}s.push(c.filter(m).join(" "));}return s.filter(m).join(" ")}(r);break;case "type":e=function(r){var t=r.as,e=r.create_definitions,n=r.keyword,o=r.name,u=r.resource,a=[h(r.type),h(n),[d(o.schema),d(o.name)].filter(m).join("."),h(t),h(u)];if(e){var s=[];switch(u){case "enum":case "range":s.push(lt(e));break;default:s.push("(".concat(e.map(Xr).join(", "),")"));}a.push(s.filter(m).join(" "));}return a.filter(m).join(" ")}(r);break;case "user":e=function(r){var t=r.attribute,e=r.comment,n=r.default_role,o=r.if_not_exists,u=r.keyword,a=r.lock_option,i=r.password_options,c=r.require,l=r.resource_options,f=r.type,p=r.user.map((function(r){var t=r.user,e=r.auth_option,n=[Rr(t)];return e&&n.push(h(e.keyword),e.auth_plugin,w(e.value)),n.filter(m).join(" ")})).join(", "),b=[h(f),h(u),h(o),p];n&&b.push(h(n.keyword),n.value.map(Rr).join(", "));b.push(s(c&&c.keyword,lt,c&&c.value)),l&&b.push(h(l.keyword),l.value.map((function(r){return lt(r)})).join(" "));i&&i.forEach((function(r){return b.push(s(r.keyword,lt,r.value))}));return b.push(w(a),j(e),w(t)),b.filter(m).join(" ")}(r);break;default:throw new Error("unknown create resource ".concat(t))}return e},comment:function(r){var t=r.expr,e=r.keyword,n=r.target;return [h(r.type),h(e),P(n),F(t)].filter(m).join(" ")},select:Y,deallocate:function(r){var t=r.type,e=r.keyword,n=r.expr;return [h(t),h(e),lt(n)].filter(m).join(" ")},delete:function(r){var t=r.columns,e=r.from,n=r.table,o=r.where,u=r.orderby,a=r.with,i=r.limit,c=r.returning,l=[q(a),"DELETE"],f=Nt(t,e);return l.push(f),Array.isArray(n)&&(1===n.length&&true===n[0].addition||l.push(Cr(n))),l.push(s("FROM",Cr,e)),l.push(s("WHERE",lt,o)),l.push(pt(u,"order by")),l.push(G(i)),l.push(T(c)),l.filter(m).join(" ")},exec:function(r){var t=r.keyword,e=r.module,n=r.parameters;return [h(t),Lr(e),(n||[]).map(K).filter(m).join(", ")].filter(m).join(" ")},execute:function(r){var t=r.type,e=r.name,n=r.args,o=[h(t)],u=[e];n&&u.push("(".concat(lt(n).join(", "),")"));return o.push(u.join("")),o.filter(m).join(" ")},explain:function(r){var t=r.type,e=r.expr;return [h(t),Y(e)].join(" ")},for:function(r){var t=r.type,e=r.label,n=r.target,o=r.query,u=r.stmts;return [e,h(t),n,"IN",ur([o]),"LOOP",ur(u),"END LOOP",e].filter(m).join(" ")},update:function(r){var t=r.from,e=r.table,n=r.set,o=r.where,u=r.orderby,a=r.with,i=r.limit,c=r.returning;return [q(a),"UPDATE",Cr(e),s("SET",X,n),s("FROM",Cr,t),s("WHERE",lt,o),pt(u,"order by"),G(i),T(c)].filter(m).join(" ")},if:function(r){var t=r.boolean_expr,e=r.else_expr,n=r.elseif_expr,o=r.if_expr,u=r.prefix,a=r.go,s=r.semicolons,i=r.suffix,c=[h(r.type),lt(t),w(u),"".concat(_r(o.ast||o)).concat(s[0]),h(a)];n&&c.push(n.map((function(r){return [h(r.type),lt(r.boolean_expr),"THEN",_r(r.then.ast||r.then),r.semicolon].filter(m).join(" ")})).join(" "));e&&c.push("ELSE","".concat(_r(e.ast||e)).concat(s[1]));return c.push(w(i)),c.filter(m).join(" ")},insert:fr,load_data:rr,drop:Ir,truncate:Ir,replace:fr,declare:function(r){var t=r.type,e=r.declare,n=r.symbol,o=[h(t)],u=e.map((function(r){var t=r.at,e=r.name,n=r.as,o=r.constant,u=r.datatype,a=r.not_null,s=r.prefix,i=r.definition,c=r.keyword,l=[[t,e].filter(m).join(""),h(n),h(o)];switch(c){case "variable":l.push(gt(u),lt(r.collate),h(a)),i&&l.push(h(i.keyword),lt(i.value));break;case "cursor":l.push(h(s));break;case "table":l.push(h(s),"(".concat(i.map(Xr).join(", "),")"));}return l.filter(m).join(" ")})).join("".concat(n," "));return o.push(u),o.join(" ")},use:function(r){var t=r.type,e=r.db,n=h(t),o=d(e);return "".concat(n," ").concat(o)},rename:function(r){var t=r.type,e=r.table,n=[],o="".concat(t&&t.toUpperCase()," TABLE");if(e){var u,a=Tr(e);try{for(a.s();!(u=a.n()).done;){var s=u.value.map(Lr);n.push(s.join(" TO "));}}catch(r){a.e(r);}finally{a.f();}}return "".concat(o," ").concat(n.join(", "))},call:function(r){var t=lt(r.expr);return "".concat("CALL"," ").concat(t)},desc:Nr,describe:Nr,set:function(r){var t=r.type,e=r.expr,n=r.keyword,o=h(t),u=e.map(lt).join(", ");return [o,h(n),u].filter(m).join(" ")},lock:Or,unlock:Or,show:er,grant:Ur,revoke:Ur,proc:function(r){var t=r.stmt;switch(t.type){case "assign":return tr(t);case "return":return function(r){var t=r.type,e=r.expr;return [h(t),lt(e)].join(" ")}(t)}},raise:function(r){var t=r.type,e=r.level,n=r.raise,o=r.using,u=[h(t),h(e)];n&&u.push([w(n.keyword),"format"===n.type&&n.expr.length>0&&","].filter(m).join(""),n.expr.map((function(r){return lt(r)})).join(", "));o&&u.push(h(o.type),h(o.option),o.symbol,o.expr.map((function(r){return lt(r)})).join(", "));return u.filter(m).join(" ")},transaction:function(r){var t=r.expr,e=t.action,n=t.keyword,o=t.modes,u=[w(e),h(n)];return o&&u.push(o.map(w).join(", ")),u.filter(m).join(" ")}};function or(r){if(!r)return "";for(var t=nr[r.type],e=r,n=e._parentheses,o=e._orderby,u=e._limit,a=[n&&"(",t(r)];r._next;){var s=nr[r._next.type],i=h(r.set_op);a.push(i,s(r._next)),r=r._next;}return a.push(n&&")",pt(o,"order by"),G(u)),a.filter(m).join(" ")}function ur(r){for(var t=[],e=0,n=r.length;e<n;++e){var o=r[e]&&r[e].ast?r[e].ast:r[e],u=or(o);e===n-1&&"transaction"===o.type&&(u="".concat(u," ;")),t.push(u);}return t.join(" ; ")}function ar(r){var t=r.type;return "select"===t?or(r):("values"===t?r.values:r).map((function(r){var t=lt(r);return [h(r.prefix),"(".concat(t,")")].filter(m).join("")})).join(", ")}function sr(r){if(!r)return "";var t=["PARTITION","("];if(Array.isArray(r))t.push(r.map((function(r){return d(r)})).join(", "));else {var e=r.value;t.push(e.map(lt).join(", "));}return t.push(")"),t.filter(m).join("")}function ir(r){if(!r)return "";switch(r.type){case "column":return "(".concat(r.expr.map(Et).join(", "),")")}}function cr(r){var t=r.expr,e=r.keyword,n=t.type,o=[h(e)];switch(n){case "origin":o.push(w(t));break;case "update":o.push("UPDATE",s("SET",X,t.set),s("WHERE",lt,t.where));}return o.filter(m).join(" ")}function lr(r){if(!r)return "";var t=r.action;return [ir(r.target),cr(t)].filter(m).join(" ")}function fr(r){var t=r.table,e=r.type,n=r.or,o=void 0===n?[]:n,u=r.prefix,a=void 0===u?"into":u,i=r.columns,c=r.conflict,l=r.values,f=r.where,p=r.on_duplicate_update,b=r.partition,v=r.returning,y=r.set,d=p||{},L=d.keyword,C=d.set,A=[h(e),o.map(w).join(" "),h(a),Cr(t),sr(b)];return Array.isArray(i)&&A.push("(".concat(i.map(w).join(", "),")")),A.push(s(l&&"values"===l.type?"VALUES":"",ar,l)),A.push(s("ON CONFLICT",lr,c)),A.push(s("SET",X,y)),A.push(s("WHERE",lt,f)),A.push(s(L,X,C)),A.push(T(v)),A.filter(m).join(" ")}function pr(r){var t=r.expr,e=r.unit,n=r.suffix;return ["INTERVAL",lt(t),h(e),lt(n)].filter(m).join(" ")}function br(r){return function(r){if(Array.isArray(r))return vr(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||function(r,t){if(r){if("string"==typeof r)return vr(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?vr(r,t):void 0}}(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function vr(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function yr(r){var t=r.type,e=r.as,n=r.expr,o=r.with_offset;return ["".concat(h(t),"(").concat(n&&lt(n)||"",")"),s("AS","string"==typeof e?d:lt,e),s(h(o&&o.keyword),d,o&&o.as)].filter(m).join(" ")}function dr(r){if(r)switch(r.type){case "pivot":case "unpivot":return function(r){var t=r.as,e=r.column,n=r.expr,o=r.in_expr,u=r.type,a=[lt(n),"FOR",Et(e),D(o)],s=["".concat(h(u),"(").concat(a.join(" "),")")];return t&&s.push("AS",d(t)),s.join(" ")}(r);default:return ""}}function hr(r){if(r){var t=r.keyword,e=r.expr,n=r.index,o=r.index_columns,u=r.parentheses,a=r.prefix,s=[];switch(t.toLowerCase()){case "forceseek":s.push(h(t),"(".concat(d(n)),"(".concat(o.map(lt).filter(m).join(", "),"))"));break;case "spatial_window_max_cells":s.push(h(t),"=",lt(e));break;case "index":s.push(h(a),h(t),u?"(".concat(e.map((function(r){return d(r)})).join(", "),")"):"= ".concat(d(e)));break;default:s.push(lt(e));}return s.filter(m).join(" ")}}function mr(r,t){var e=r.name,n=r.symbol;return [h(e),n,t].filter(m).join(" ")}function wr(r){var t=[];switch(r.keyword){case "as":t.push("AS","OF",lt(r.of));break;case "from_to":t.push("FROM",lt(r.from),"TO",lt(r.to));break;case "between_and":t.push("BETWEEN",lt(r.between),"AND",lt(r.and));break;case "contained":t.push("CONTAINED","IN",lt(r.in));}return t.filter(m).join(" ")}function Lr(r){if("UNNEST"===h(r.type))return yr(r);var t,e,n,o,u=r.table,a=r.db,i=r.as,c=r.expr,l=r.operator,f=r.prefix,p=r.schema,b=r.server,v=r.suffix,y=r.tablesample,C=r.temporal_table,A=r.table_hint,E=r.surround,g=void 0===E?{}:E,j=d(b,false,g.server),_=d(a,false,g.db),T=d(p,false,g.schema),S=u&&d(u,false,g.table);if(c)switch(c.type){case "values":var x=c.parentheses,k=c.values,I=c.prefix,N=[x&&"(","",x&&")"],O=ar(k);I&&(O=O.split("(").slice(1).map((function(r){return "".concat(h(I),"(").concat(r)})).join("")),N[1]="VALUES ".concat(O),S=N.filter(m).join("");break;case "tumble":S=function(r){if(!r)return "";var t=r.data,e=r.timecol,n=r.offset,o=r.size,u=[d(t.expr.db),d(t.expr.schema),d(t.expr.table)].filter(m).join("."),a="DESCRIPTOR(".concat(Et(e.expr),")"),s=["TABLE(TUMBLE(TABLE ".concat(mr(t,u)),mr(e,a)],i=mr(o,pr(o.expr));return n&&n.expr?s.push(i,"".concat(mr(n,pr(n.expr)),"))")):s.push("".concat(i,"))")),s.filter(m).join(", ")}(c);break;case "generator":e=(t=c).keyword,n=t.type,o=t.generators.map((function(r){return L(r).join(" ")})).join(", "),S="".concat(h(e),"(").concat(h(n),"(").concat(o,"))");break;default:S=lt(c);}var R=[[j,_,T,S=[h(f),S,h(v)].filter(m).join(" ")].filter(m).join(".")];if(y){var U=["TABLESAMPLE",lt(y.expr),w(y.repeatable)].filter(m).join(" ");R.push(U);}R.push(function(r){if(r){var t=r.keyword,e=r.expr;return [h(t),wr(e)].filter(m).join(" ")}}(C),s("AS","string"==typeof i?d:lt,i),dr(l)),A&&R.push(h(A.keyword),"(".concat(A.expr.map(hr).filter(m).join(", "),")"));var M=R.filter(m).join(" ");return r.parentheses?"(".concat(M,")"):M}function Cr(r){if(!r)return "";if(!Array.isArray(r)){var t=r.expr,e=r.parentheses,n=r.joins,o=Cr(t);if(e){for(var u=[],a=[],i=true===e?1:e.length,c=0;c++<i;)u.push("("),a.push(")");var l=n&&n.length>0?Cr([""].concat(br(n))):"";return u.join("")+o+a.join("")+l}return o}var f=r[0],p=[];if("dual"===f.type)return "DUAL";p.push(Lr(f));for(var b=1;b<r.length;++b){var v=r[b],y=v.on,d=v.using,L=v.join,C=[],A=Array.isArray(v)||Object.hasOwnProperty.call(v,"joins");C.push(L?" ".concat(h(L)):","),C.push(A?Cr(v):Lr(v)),C.push(s("ON",lt,y)),d&&C.push("USING (".concat(d.map(w).join(", "),")")),p.push(C.filter(m).join(" "));}return p.filter(m).join("")}function Ar(r){var t=r.keyword,e=r.symbol,n=r.value,o=[t.toUpperCase()];e&&o.push(e);var u=w(n);switch(t){case "partition by":case "default collate":u=lt(n);break;case "options":u="(".concat(n.map((function(r){return [r.keyword,r.symbol,lt(r.value)].join(" ")})).join(", "),")");break;case "cluster by":u=n.map(lt).join(", ");}return o.push(u),o.filter(m).join(" ")}var Er=["analyze","attach","select","deallocate","delete","exec","update","insert","drop","rename","truncate","call","desc","describe","use","alter","set","create","lock","unlock","declare","show","replace","if","grant","revoke","proc","raise","execute","transaction","explain","comment","load_data"];function gr(r){var t=r&&r.ast?r.ast:r;if(!Er.includes(t.type))throw new Error("".concat(t.type," statements not supported at the moment"))}function jr(r){return Array.isArray(r)?(r.forEach(gr),ur(r)):(gr(r),or(r))}function _r(r){return "go"===r.go?function r(t){if(!t||0===t.length)return "";var e=[jr(t.ast)];return t.go_next&&e.push(t.go.toUpperCase(),r(t.go_next)),e.filter((function(r){return r})).join(" ")}(r):jr(r)}function Tr(r,t){var e="undefined"!=typeof Symbol&&r[Symbol.iterator]||r["@@iterator"];if(!e){if(Array.isArray(r)||(e=xr(r))||t){e&&(r=e);var n=0,o=function(){};return {s:o,n:function(){return n>=r.length?{done:true}:{done:false,value:r[n++]}},e:function(r){throw r},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var u,a=true,s=false;return {s:function(){e=e.call(r);},n:function(){var r=e.next();return a=r.done,r},e:function(r){s=true,u=r;},f:function(){try{a||null==e.return||e.return();}finally{if(s)throw u}}}}function Sr(r){return function(r){if(Array.isArray(r))return kr(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||xr(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function xr(r,t){if(r){if("string"==typeof r)return kr(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?kr(r,t):void 0}}function kr(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function Ir(r){var t=r.type,e=r.keyword,n=r.name,o=r.prefix,u=r.suffix,a=[h(t),h(e),h(o)];switch(e){case "table":a.push(Cr(n));break;case "trigger":a.push([n[0].schema?"".concat(d(n[0].schema),"."):"",d(n[0].trigger)].filter(m).join(""));break;case "database":case "schema":case "procedure":a.push(d(n));break;case "view":a.push(Cr(n),r.options&&r.options.map(lt).filter(m).join(" "));break;case "index":a.push.apply(a,[Et(n)].concat(Sr(r.table?["ON",Lr(r.table)]:[]),[r.options&&r.options.map(lt).filter(m).join(" ")]));break;case "type":a.push(n.map(Et).join(", "),r.options&&r.options.map(lt).filter(m).join(" "));}return u&&a.push(u.map(lt).filter(m).join(" ")),a.filter(m).join(" ")}function Nr(r){var t=r.type,e=r.table,n=h(t),o="string"==typeof e?d(e):Lr(e);return "".concat(n," ").concat(o)}function Or(r){var t=r.type,e=r.keyword,n=r.tables,o=[t.toUpperCase(),h(e)];if("UNLOCK"===t.toUpperCase())return o.join(" ");var u,a=[],s=Tr(n);try{var i=function(){var r=u.value,t=r.table,e=r.lock_type,n=[Lr(t)];if(e){n.push(["prefix","type","suffix"].map((function(r){return h(e[r])})).filter(m).join(" "));}a.push(n.join(" "));};for(s.s();!(u=s.n()).done;)i();}catch(r){s.e(r);}finally{s.f();}return o.push.apply(o,[a.join(", ")].concat(Sr(function(r){var t=r.lock_mode,e=r.nowait,n=[];if(t){var o=t.mode;n.push(o.toUpperCase());}return e&&n.push(e.toUpperCase()),n}(r)))),o.filter(m).join(" ")}function Rr(r){var t=r.name,e=r.host,n=[w(t)];return e&&n.push("@",w(e)),n.join("")}function Ur(r){var t=r.type,e=r.grant_option_for,n=r.keyword,o=r.objects,u=r.on,a=r.to_from,s=r.user_or_roles,i=r.with,c=[h(t),w(e)],l=o.map((function(r){var t=r.priv,e=r.columns,n=[lt(t)];return e&&n.push("(".concat(e.map(Et).join(", "),")")),n.join(" ")})).join(", ");if(c.push(l),u)switch(c.push("ON"),n){case "priv":c.push(w(u.object_type),u.priv_level.map((function(r){return [d(r.prefix),d(r.name)].filter(m).join(".")})).join(", "));break;case "proxy":c.push(Rr(u));}return c.push(h(a),s.map(Rr).join(", ")),c.push(w(i)),c.filter(m).join(" ")}function Mr(r){return function(r){if(Array.isArray(r))return Dr(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||function(r,t){if(r){if("string"==typeof r)return Dr(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?Dr(r,t):void 0}}(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function Dr(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function Pr(r){if(r){var t=r.constraint,e=r.constraint_type,n=r.enforced,o=r.index,u=r.keyword,a=r.reference_definition,i=r.for,c=r.with_values,l=[],f=p().database;l.push(h(u)),l.push(d(t));var b=h(e);return "sqlite"===f.toLowerCase()&&"UNIQUE KEY"===b&&(b="UNIQUE"),l.push(b),l.push("sqlite"!==f.toLowerCase()&&d(o)),l.push.apply(l,Mr(M(r))),l.push.apply(l,Mr(jt(a))),l.push(h(n)),l.push(s("FOR",d,i)),l.push(w(c)),l.filter(m).join(" ")}}function Fr(r){if(r){var t=r.type;return "rows"===t?[h(t),lt(r.expr)].filter(m).join(" "):lt(r)}}function $r(r){if("string"==typeof r)return r;var t=r.window_specification;return "(".concat(function(r){var t=r.name,e=r.partitionby,n=r.orderby,o=r.window_frame_clause;return [t,pt(e,"partition by"),pt(n,"order by"),Fr(o)].filter(m).join(" ")}(t),")")}function Hr(r){var t=r.name,e=r.as_window_specification;return "".concat(t," AS ").concat($r(e))}function Br(r){if(r){var t=r.as_window_specification,e=r.expr,n=r.keyword,o=r.type,u=r.parentheses,a=h(o);if("WINDOW"===a)return "OVER ".concat($r(t));if("ON UPDATE"===a){var s="".concat(h(o)," ").concat(h(n)),i=lt(e)||[];return u&&(s="".concat(s,"(").concat(i.join(", "),")")),s}if(r.partitionby)return ["OVER","(".concat(pt(r.partitionby,"partition by")),"".concat(pt(r.orderby,"order by"),")")].filter(m).join(" ");throw new Error("unknown over type")}}function Gr(r){if(!r||!r.array)return "";var t=r.array.keyword;if(t)return h(t);for(var e=r.array,n=e.dimension,o=e.length,u=[],a=0;a<n;a++)u.push("["),o&&o[a]&&u.push(w(o[a])),u.push("]");return u.join("")}function qr(r){for(var t=r.target,e=r.expr,n=r.keyword,o=r.symbol,u=r.as,a=r.offset,s=r.parentheses,i=r.collate,c=Ct({expr:e,offset:a}),l=[],f=0,p=t.length;f<p;++f){var b=t[f],v=b.angle_brackets,y=b.length,L=b.dataType,C=b.parentheses,A=b.quoted,E=b.scale,g=b.suffix,j=b.expr,_=j?lt(j):"";null!=y&&(_=E?"".concat(y,", ").concat(E):y),C&&(_="(".concat(_,")")),v&&(_="<".concat(_,">")),g&&g.length&&(_+=" ".concat(g.map(w).join(" ")));var T="::",S="",x=[];"as"===o&&(0===f&&(c="".concat(h(n),"(").concat(c)),S=")",T=" ".concat(o.toUpperCase()," ")),0===f&&x.push(c);var k=Gr(b);x.push(T,A,L,A,k,_,S),l.push(x.filter(m).join(""));}var I=bt(i);u&&l.push(" AS ".concat(d(u)));var N=[l.filter(m).join(""),I].filter(m).join(" ");return s?"(".concat(N,")"):N}function Wr(r){var t=r.args,e=r.array_index,n=r.collate,o=r.name,u=r.args_parentheses,a=r.parentheses,s=r.within_group,i=r.over,c=r.suffix,l=Br(i),f=function(r){if(!r)return "";var t=r.type,e=r.keyword,n=r.orderby;return [h(t),h(e),"(".concat(pt(n,"order by"),")")].filter(m).join(" ")}(s),p=lt(c),b=bt(n),v=[w(o.schema),o.name.map(w).join(".")].filter(m).join(".");if(!t)return [v,b,f,l].filter(m).join(" ");var y=r.separator||", ",d=0;if("TRIM"===h(v))for(var L=0,C=t.value.length;L<C;++L){var A=t.value[L];if("origin"===A.type&&"from"===A.value){d=L;break}}var E=[v];E.push(false===u?" ":"(");var g=lt(t);if(Array.isArray(y)){for(var j=g[0],_=1,T=g.length;_<T;++_)j=[j,g[_]].join(" ".concat(lt(y[_-1])," "));E.push(j);}else "TRIM"===h(v)&&d>0?E.push([g.slice(0,d+1).join(" "),g.slice(d+1).join(", ")].join(" ")):E.push(g.join(y));return  false!==u&&E.push(")"),E.push(At(e)),E=[E.join(""),p,b].filter(m).join(" "),[a?"(".concat(E,")"):E,f,l].filter(m).join(" ")}function Yr(r){return function(r){if(Array.isArray(r))return Qr(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||Vr(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function Vr(r,t){if(r){if("string"==typeof r)return Qr(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?Qr(r,t):void 0}}function Qr(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function Xr(r){if(!r)return [];var t,e,n,o,u=r.resource;switch(u){case "column":return St(r);case "index":return e=[],n=(t=r).keyword,o=t.index,e.push(h(n)),e.push(o),e.push.apply(e,I(M(t))),e.filter(m).join(" ");case "constraint":return Pr(r);case "sequence":return [h(r.prefix),lt(r.value)].filter(m).join(" ");default:throw new Error("unknown resource = ".concat(u," type"))}}function Kr(r){var t=[];switch(r.keyword){case "from":t.push("FROM","(".concat(w(r.from),")"),"TO","(".concat(w(r.to),")"));break;case "in":t.push("IN","(".concat(lt(r.in),")"));break;case "with":t.push("WITH","(MODULUS ".concat(w(r.modulus),", REMAINDER ").concat(w(r.remainder),")"));}return t.filter(m).join(" ")}function zr(r){var t=r.keyword,e=r.table,n=r.for_values,o=r.tablespace,u=[h(t),Lr(e),h(n.keyword),Kr(n.expr)];return o&&u.push("TABLESPACE",w(o)),u.filter(m).join(" ")}function Zr(r){return r.dataType?E(r):[d(r.db),d(r.schema),d(r.table)].filter(m).join(".")}function Jr(r){var t=r.type;switch(t){case "as":return [h(t),r.symbol,or(r.declare),h(r.begin),ur(r.expr),h(r.end),r.symbol].filter(m).join(" ");case "set":return [h(t),r.parameter,h(r.value&&r.value.prefix),r.value&&r.value.expr.map(lt).join(", ")].filter(m).join(" ");case "return":return [h(t),lt(r.expr)].filter(m).join(" ");default:return lt(r)}}function rt(r){var t=r.type,e=r.symbol,n=r.value,o=[h(t),e];switch(h(t)){case "SFUNC":o.push([d(n.schema),n.name].filter(m).join("."));break;case "STYPE":case "MSTYPE":o.push(E(n));break;default:o.push(lt(n));}return o.filter(m).join(" ")}function tt(r,t){switch(r){case "add":var e=t.map((function(r){var t=r.name,e=r.value;return ["PARTITION",w(t),"VALUES",h(e.type),"(".concat(w(e.expr),")")].join(" ")})).join(", ");return "(".concat(e,")");default:return Nt(t)}}function et(r){if(!r)return "";var t=r.action,e=r.create_definitions,n=r.if_not_exists,o=r.keyword,u=r.if_exists,a=r.old_column,s=r.prefix,i=r.resource,c=r.symbol,l=r.suffix,f="",p=[];switch(i){case "column":p=[St(r)];break;case "index":p=M(r),f=r[i];break;case "table":case "schema":f=d(r[i]);break;case "aggregate":case "function":case "domain":case "type":f=d(r[i]);break;case "algorithm":case "lock":case "table-option":f=[c,h(r[i])].filter(m).join(" ");break;case "constraint":f=d(r[i]),p=[Xr(e)];break;case "partition":p=[tt(t,r.partitions)];break;case "key":f=d(r[i]);break;default:f=[c,r[i]].filter((function(r){return null!==r})).join(" ");}var b=[h(t),h(o),h(n),h(u),a&&Et(a),h(s),f&&f.trim(),p.filter(m).join(" ")];return l&&b.push(h(l.keyword),l.expr&&Et(l.expr)),b.filter(m).join(" ")}function nt(r){var t=r.default&&[h(r.default.keyword),lt(r.default.value)].join(" ");return [h(r.mode),r.name,E(r.type),t].filter(m).join(" ")}function ot(r){return (ot="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}function ut(r){var t=r.expr_list;switch(h(r.type)){case "STRUCT":case "ROW":return "(".concat(Nt(t),")");case "ARRAY":return function(r){var t=r.array_path,e=r.brackets,n=r.expr_list,o=r.parentheses;if(!n)return "[".concat(Nt(t),"]");var u=Array.isArray(n)?n.map((function(r){return "(".concat(Nt(r),")")})).filter(m).join(", "):lt(n);return e?"[".concat(u,"]"):o?"(".concat(u,")"):u}(r);default:return ""}}function at(r){var t=r.definition,e=r.keyword,n=r.orderby,o=r.limit,u=[h(e)];return t&&"object"===ot(t)&&(u.length=0,u.push(g(t))),u.push(ut(r),pt(n,"order by"),G(o)),u.filter(m).join("")}function st(r){return (st="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}var it={alter:et,aggr_func:function(r){var t=r.args,e=r.filter,n=r.over,o=r.within_group_orderby,u=lt(t.expr);u=Array.isArray(u)?u.join(", "):u;var a=r.name,s=Br(n);t.distinct&&(u=["DISTINCT",u].join(" ")),t.separator&&t.separator.delimiter&&(u=[u,w(t.separator.delimiter)].join("".concat(t.separator.symbol," "))),t.separator&&t.separator.expr&&(u=[u,lt(t.separator.expr)].join(" ")),t.orderby&&(u=[u,pt(t.orderby,"order by")].join(" ")),t.separator&&t.separator.value&&(u=[u,h(t.separator.keyword),w(t.separator.value)].filter(m).join(" "));var i=o?"WITHIN GROUP (".concat(pt(o,"order by"),")"):"",c=e?"FILTER (WHERE ".concat(lt(e.where),")"):"";return ["".concat(a,"(").concat(u,")"),i,s,c].filter(m).join(" ")},any_value:function(r){var t=r.args,e=r.type,n=r.over,o=t.expr,u=t.having,a="".concat(h(e),"(").concat(lt(o));return u&&(a="".concat(a," HAVING ").concat(h(u.prefix)," ").concat(lt(u.expr))),[a="".concat(a,")"),Br(n)].filter(m).join(" ")},window_func:function(r){var t=r.over;return [function(r){var t=r.args,e=r.name,n=r.consider_nulls,o=void 0===n?"":n,u=r.separator,a=void 0===u?", ":u;return [e,"(",t?lt(t).join(a):"",")",o&&" ",o].filter(m).join("")}(r),Br(t)].filter(m).join(" ")},array:at,assign:tr,binary_expr:D,case:function(r){var t=["CASE"],e=r.args,n=r.expr,o=r.parentheses;n&&t.push(lt(n));for(var u=0,a=e.length;u<a;++u)t.push(e[u].type.toUpperCase()),e[u].cond&&(t.push(lt(e[u].cond)),t.push("THEN")),t.push(lt(e[u].result));return t.push("END"),o?"(".concat(t.join(" "),")"):t.join(" ")},cast:qr,collate:bt,column_ref:Et,column_definition:St,datatype:E,extract:function(r){var t=r.args,e=r.type,n=t.field,o=t.cast_type,u=t.source,a=["".concat(h(e),"(").concat(h(n)),"FROM",h(o),lt(u)];return "".concat(a.filter(m).join(" "),")")},flatten:function(r){var t=r.args,e=r.type,n=["input","path","outer","recursive","mode"].map((function(r){return function(r){if(!r)return "";var t=r.type,e=r.symbol,n=r.value;return [h(t),e,lt(n)].filter(m).join(" ")}(t[r])})).filter(m).join(", ");return "".concat(h(e),"(").concat(n,")")},fulltext_search:function(r){var t=r.against,e=r.as,n=r.columns,o=r.match,u=r.mode,a=[h(o),"(".concat(n.map((function(r){return Et(r)})).join(", "),")")].join(" "),s=[h(t),["(",lt(r.expr),u&&" ".concat(w(u)),")"].filter(m).join("")].join(" ");return [a,s,xt(e)].filter(m).join(" ")},function:Wr,lambda:function(r){var t=r.args,e=r.expr,n=t.value,o=t.parentheses,u=n.map(lt).join(", ");return [o?"(".concat(u,")"):u,"->",lt(e)].join(" ")},load_data:rr,insert:or,interval:pr,json:function(r){var t=r.keyword,e=r.expr_list;return [h(t),e.map((function(r){return lt(r)})).join(", ")].join(" ")},json_object_arg:function(r){var t=r.expr,e=t.key,n=t.value,o=t.on,u=[lt(e),"VALUE",lt(n)];return o&&u.push("ON","NULL",lt(o)),u.filter(m).join(" ")},json_visitor:function(r){return [r.symbol,lt(r.expr)].join("")},func_arg:function(r){var t=r.value;return [t.name,t.symbol,lt(t.expr)].filter(m).join(" ")},show:er,struct:at,tablefunc:function(r){var t=r.as,e=r.name,n=r.args,o=[w(e.schema),e.name.map(w).join(".")].filter(m).join(".");return ["".concat(o,"(").concat(lt(n).join(", "),")"),"AS",Wr(t)].join(" ")},tables:Cr,unnest:yr,values:ar,window:function(r){return r.expr.map(Hr).join(", ")}};function ct(r){var t=r.prefix,e=void 0===t?"@":t,n=r.name,o=r.members,u=r.quoted,a=r.suffix,s=[],i=o&&o.length>0?"".concat(n,".").concat(o.join(".")):n,c="".concat(e||"").concat(i);return a&&(c+=a),s.push(c),[u,s.join(" "),u].filter(m).join("")}function lt(r){if(r){var t=r;if(r.ast){var e=t.ast;Reflect.deleteProperty(t,e);for(var n=0,o=Object.keys(e);n<o.length;n++){var u=o[n];t[u]=e[u];}}var a=t.type;return "expr"===a?lt(t.expr):it[a]?it[a](t):w(t)}}function ft(r){return r?(Array.isArray(r)||(r=[r]),r.map(lt)):[]}function pt(r,t){if(!Array.isArray(r))return "";var e=[],n=h(t);switch(n){case "ORDER BY":e=r.map((function(r){return [lt(r.expr),r.type||"ASC",h(r.nulls)].filter(m).join(" ")}));break;case "PARTITION BY":default:e=r.map((function(r){return lt(r.expr)}));}return i(n,e.join(", "))}function bt(r){if(r){var t=r.keyword,e=r.collate,n=e.name,o=e.symbol,u=e.value,a=[h(t)];return u||a.push(o),a.push(Array.isArray(n)?n.map(w).join("."):w(n)),u&&a.push(o),a.push(lt(u)),a.filter(m).join(" ")}}function vt(r){return (vt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}function yt(r,t){var e=Object.keys(r);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(r);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(r,t).enumerable}))),e.push.apply(e,n);}return e}function dt(r){for(var t=1;t<arguments.length;t++){var e=null!=arguments[t]?arguments[t]:{};t%2?yt(Object(e),true).forEach((function(t){ht(r,t,e[t]);})):Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropertyDescriptors(e)):yt(Object(e)).forEach((function(t){Object.defineProperty(r,t,Object.getOwnPropertyDescriptor(e,t));}));}return r}function ht(r,t,e){return (t=function(r){var t=function(r,t){if("object"!=vt(r)||!r)return r;var e=r[Symbol.toPrimitive];if(void 0!==e){var n=e.call(r,t);if("object"!=vt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return ("string"===t?String:Number)(r)}(r,"string");return "symbol"==vt(t)?t:t+""}(t))in r?Object.defineProperty(r,t,{value:e,enumerable:true,configurable:true,writable:true}):r[t]=e,r}function mt(r){return function(r){if(Array.isArray(r))return Lt(r)}(r)||function(r){if("undefined"!=typeof Symbol&&null!=r[Symbol.iterator]||null!=r["@@iterator"])return Array.from(r)}(r)||wt(r)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function wt(r,t){if(r){if("string"==typeof r)return Lt(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?Lt(r,t):void 0}}function Lt(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function Ct(r,t){if("string"==typeof r)return d(r,t);var e=r.expr,n=r.offset,o=r.suffix,u=n&&n.map((function(r){return ["[",r.name,"".concat(r.name?"(":""),w(r.value),"".concat(r.name?")":""),"]"].filter(m).join("")})).join("");return [lt(e),u,o].filter(m).join("")}function At(r){if(!r||0===r.length)return "";var t,e=[],n=function(r,t){var e="undefined"!=typeof Symbol&&r[Symbol.iterator]||r["@@iterator"];if(!e){if(Array.isArray(r)||(e=wt(r))||t){e&&(r=e);var n=0,o=function(){};return {s:o,n:function(){return n>=r.length?{done:true}:{done:false,value:r[n++]}},e:function(r){throw r},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var u,a=true,s=false;return {s:function(){e=e.call(r);},n:function(){var r=e.next();return a=r.done,r},e:function(r){s=true,u=r;},f:function(){try{a||null==e.return||e.return();}finally{if(s)throw u}}}}(r);try{for(n.s();!(t=n.n()).done;){var o=t.value,u=o.brackets?"[".concat(lt(o.index),"]"):"".concat(o.notation).concat(lt(o.index));o.property&&(u="".concat(u,".").concat(w(o.property))),e.push(u);}}catch(r){n.e(r);}finally{n.f();}return e.join("")}function Et(r){var t=r.array_index,e=r.as,n=r.column,o=r.collate,u=r.db,a=r.isDual,i=r.notations,c=void 0===i?[]:i,l=r.options,f=r.schema,p=r.table,b=r.parentheses,v=r.suffix,y=r.order_by,w=r.subFields,L=void 0===w?[]:w,C="*"===n?"*":Ct(n,a),A=[u,f,p].filter(m).map((function(r){return "".concat("string"==typeof r?d(r):lt(r))})),E=A[0];if(E){for(var g=1;g<A.length;++g)E="".concat(E).concat(c[g]||".").concat(A[g]);C="".concat(E).concat(c[g]||".").concat(C);}var j=[C=["".concat(C).concat(At(t))].concat(mt(L)).join("."),bt(o),lt(l),s("AS",lt,e)];j.push("string"==typeof v?h(v):lt(v)),j.push(h(y));var _=j.filter(m).join(" ");return b?"(".concat(_,")"):_}function gt(r){if(r){var t=r.schema,e=r.dataType,n=r.length,o=r.suffix,u=r.scale,a=r.expr,s=E({schema:t,dataType:e,length:n,suffix:o,scale:u,parentheses:null!=n});if(a&&(s+=lt(a)),r.array){var i=Gr(r);s+=[/^\[.*\]$/.test(i)?"":" ",i].join("");}return s}}function jt(r){var t=[];if(!r)return t;var e=r.definition,n=r.keyword,o=r.match,u=r.table,a=r.on_action;return t.push(h(n)),t.push(Cr(u)),t.push(e&&"(".concat(e.map((function(r){return lt(r)})).join(", "),")")),t.push(h(o)),a.map((function(r){return t.push(h(r.type),lt(r.value))})),t.filter(m)}function _t(r){var t=[],e=r.nullable,n=r.character_set,o=r.check,u=r.comment,a=r.constraint,i=r.collate,c=r.storage,l=r.using,f=r.default_val,b=r.generated,v=r.auto_increment,y=r.unique,d=r.primary_key,C=r.column_format,A=r.reference_definition,E=r.generated_by_default,g=[h(e&&e.action),h(e&&e.value)].filter(m).join(" ");if(b||t.push(g),f){var _=f.type,T=f.value;t.push(_.toUpperCase(),lt(T));}var S=p().database;return a&&t.push(h(a.keyword),w(a.constraint)),t.push(Pr(o)),t.push(function(r){if(r)return [h(r.value),"(".concat(lt(r.expr),")"),h(r.storage_type)].filter(m).join(" ")}(b)),b&&t.push(g),t.push(x(v),h(d),h(y),w(E),j(u)),t.push.apply(t,mt(L(n))),"sqlite"!==S.toLowerCase()&&t.push(lt(i)),t.push.apply(t,mt(L(C))),t.push.apply(t,mt(L(c))),t.push.apply(t,mt(jt(A))),t.push(s("USING",lt,l)),t.filter(m).join(" ")}function Tt(r){var t=r.order_by,e=r.column,n=r.collate,o=r.nulls,u=r.opclass,a="string"==typeof e?{type:"column_ref",table:r.table,column:e}:dt(dt({},r),{},{order_by:null});return a.collate=null,[lt(a),lt(n),u,h(t),h(o)].filter(m).join(" ")}function St(r){var t=[],e=Et(r.column),n=gt(r.definition);return t.push(e),t.push(n),t.push(_t(r)),t.filter(m).join(" ")}function xt(r){return r?"object"===vt(r)?["AS",lt(r)].join(" "):["AS",/^(`?)[a-z_][0-9a-z_]*(`?)$/i.test(r)?d(r):y(r)].join(" "):""}function kt(r,t){var e=r.expr,n=r.type;if("cast"===n)return qr(r);t&&(e.isDual=t);var o=lt(e),u=r.expr_list;if(u){var a=[o],s=u.map((function(r){return kt(r,t)})).join(", ");return a.push([h(n),n&&"(",s,n&&")"].filter(m).join("")),a.filter(m).join(" ")}return e.parentheses&&Reflect.has(e,"array_index")&&"cast"!==e.type&&(o="(".concat(o,")")),e.array_index&&"column_ref"!==e.type&&"function"!==e.type&&(o="".concat(o).concat(At(e.array_index))),[o,xt(r.as)].filter(m).join(" ")}function It(r){var t=Array.isArray(r)&&r[0];return !(!t||"dual"!==t.type)}function Nt(r,t){if(!r||"*"===r)return r;var e=It(t);return r.map((function(r){return kt(r,e)})).join(", ")}it.var=ct,it.expr_list=function(r){var t=ft(r.value),e=r.parentheses,n=r.separator;if(!e&&!n)return t;var o=n||", ",u=t.join(o);return e?"(".concat(u,")"):u},it.select=function(r){var t="object"===st(r._next)?or(r):Y(r);return r.parentheses?"(".concat(t,")"):t},it.unary_expr=function(r){var t=r.operator,e=r.parentheses,n=r.expr,o="-"===t||"+"===t||"~"===t||"!"===t?"":" ",u="".concat(t).concat(o).concat(lt(n));return e?"(".concat(u,")"):u},it.map_object=function(r){var t=r.keyword,e=r.expr.map((function(r){return [w(r.key),w(r.value)].join(", ")})).join(", ");return [h(t),"[".concat(e,"]")].join("")};var Ot=e(0);function Rt(r){return (Rt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}var Ut,Mt,Dt,Pt=(Ut={},Mt="sqlite",Dt=Ot.parse,(Mt=function(r){var t=function(r,t){if("object"!=Rt(r)||!r)return r;var e=r[Symbol.toPrimitive];if(void 0!==e){var n=e.call(r,t);if("object"!=Rt(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return ("string"===t?String:Number)(r)}(r,"string");return "symbol"==Rt(t)?t:t+""}(Mt))in Ut?Object.defineProperty(Ut,Mt,{value:Dt,enumerable:true,configurable:true,writable:true}):Ut[Mt]=Dt,Ut);function Ft(r){return (Ft="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}function $t(r,t){var e="undefined"!=typeof Symbol&&r[Symbol.iterator]||r["@@iterator"];if(!e){if(Array.isArray(r)||(e=function(r,t){if(r){if("string"==typeof r)return Ht(r,t);var e={}.toString.call(r).slice(8,-1);return "Object"===e&&r.constructor&&(e=r.constructor.name),"Map"===e||"Set"===e?Array.from(r):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?Ht(r,t):void 0}}(r))||t){e&&(r=e);var n=0,o=function(){};return {s:o,n:function(){return n>=r.length?{done:true}:{done:false,value:r[n++]}},e:function(r){throw r},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var u,a=true,s=false;return {s:function(){e=e.call(r);},n:function(){var r=e.next();return a=r.done,r},e:function(r){s=true,u=r;},f:function(){try{a||null==e.return||e.return();}finally{if(s)throw u}}}}function Ht(r,t){(null==t||t>r.length)&&(t=r.length);for(var e=0,n=Array(t);e<t;e++)n[e]=r[e];return n}function Bt(r,t){for(var e=0;e<t.length;e++){var n=t[e];n.enumerable=n.enumerable||false,n.configurable=true,"value"in n&&(n.writable=true),Object.defineProperty(r,Gt(n.key),n);}}function Gt(r){var t=function(r,t){if("object"!=Ft(r)||!r)return r;var e=r[Symbol.toPrimitive];if(void 0!==e){var n=e.call(r,t);if("object"!=Ft(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return (String)(r)}(r,"string");return "symbol"==Ft(t)?t:t+""}var qt=function(){return function(r,t,e){return t&&Bt(r.prototype,t),Object.defineProperty(r,"prototype",{writable:false}),r}((function r(){!function(r,t){if(!(r instanceof t))throw new TypeError("Cannot call a class as a function")}(this,r);}),[{key:"astify",value:function(r){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u,e=this.parse(r,t);return e&&e.ast}},{key:"sqlify",value:function(r){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u;return b(t),_r(r)}},{key:"exprToSQL",value:function(r){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u;return b(t),lt(r)}},{key:"columnsToSQL",value:function(r,t){var e=arguments.length>2&&void 0!==arguments[2]?arguments[2]:u;if(b(e),!r||"*"===r)return [];var n=It(t);return r.map((function(r){return kt(r,n)}))}},{key:"parse",value:function(r){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u,e=t.database,n=void 0===e?"sqlite":e;b(t);var o=n.toLowerCase();if(Pt[o])return Pt[o](false===t.trimQuery?r:r.trim(),t.parseOptions||u.parseOptions);throw new Error("".concat(n," is not supported currently"))}},{key:"whiteListCheck",value:function(r,t){var e=arguments.length>2&&void 0!==arguments[2]?arguments[2]:u;if(t&&0!==t.length){var n=e.type,o=void 0===n?"table":n;if(!this["".concat(o,"List")]||"function"!=typeof this["".concat(o,"List")])throw new Error("".concat(o," is not valid check mode"));var a,s=this["".concat(o,"List")].bind(this),i=s(r,e),c=true,l="",f=$t(i);try{for(f.s();!(a=f.n()).done;){var p,b=a.value,v=!1,y=$t(t);try{for(y.s();!(p=y.n()).done;){var d=p.value,h=new RegExp("^".concat(d,"$"),"i");if(h.test(b)){v=!0;break}}}catch(r){y.e(r);}finally{y.f();}if(!v){l=b,c=!1;break}}}catch(r){f.e(r);}finally{f.f();}if(!c)throw new Error("authority = '".concat(l,"' is required in ").concat(o," whiteList to execute SQL = '").concat(r,"'"))}}},{key:"tableList",value:function(r,t){var e=this.parse(r,t);return e&&e.tableList}},{key:"columnList",value:function(r,t){var e=this.parse(r,t);return e&&e.columnList}}])}();function Wt(r){return (Wt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(r){return typeof r}:function(r){return r&&"function"==typeof Symbol&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r})(r)}"object"===("undefined"==typeof self?"undefined":Wt(self))&&self&&(self.NodeSQLParser={Parser:qt,util:n}),"undefined"==typeof commonjsGlobal&&"object"===("undefined"==typeof window?"undefined":Wt(window))&&window&&(window.global=window),"object"===("undefined"==typeof commonjsGlobal?"undefined":Wt(commonjsGlobal))&&commonjsGlobal&&commonjsGlobal.window&&(commonjsGlobal.window.NodeSQLParser={Parser:qt,util:n});}]));
			
		} (sqlite));
		return sqlite;
	}

	var sqliteExports = requireSqlite();
	var SQLiteParser = /*@__PURE__*/getDefaultExportFromCjs(sqliteExports);

	const parser = new SQLiteParser.Parser();
	const identifierStart = /[A-Za-z_\u0080-\uFFFF]/;
	const identifierPart = /[A-Za-z0-9_$\u0080-\uFFFF]/;
	const asciiFold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
	class Unsupported extends Error {
	    constructor(code, message) { super(message); this.name = 'Unsupported'; this.code = code; }
	}

	/** SQLite lexical boundaries, including unterminated constructs Lezer intentionally tolerates. */
	function lex(sql) {
	    if (typeof sql !== 'string') throw new Unsupported('input-type', 'SQL must be a string.');
	    const tokens = [];
	    for (let i = 0; i < sql.length;) {
	        if (/\s/.test(sql[i])) { ++i; continue; }
	        if (sql.startsWith('--', i)) { const n = sql.indexOf('\n', i + 2); i = n < 0 ? sql.length : n + 1; continue; }
	        if (sql.startsWith('/*', i)) {
	            const end = sql.indexOf('*/', i + 2);
	            if (end < 0) throw new Unsupported('unterminated-comment', 'The SQL comment is not terminated.');
	            i = end + 2; continue;
	        }
	        const start = i, quote = sql[i];
	        if (quote === "'" || quote === '"' || quote === '`' || quote === '[') {
	            const close = quote === '[' ? ']' : quote;
	            ++i; let value = '', closed = false;
	            while (i < sql.length) {
	                if (sql[i] === close) {
	                    if (close !== ']' && sql[i + 1] === close) { value += close; i += 2; continue; }
	                    ++i; closed = true; break;
	                }
	                value += sql[i++];
	            }
	            if (!closed) throw new Unsupported('unterminated-quote', 'A SQL string or identifier is not terminated.');
	            tokens.push({kind: quote === "'" ? 'String' : 'Identifier', text: sql.slice(start, i), value});
	        } else if (identifierStart.test(sql[i])) {
	            ++i; while (i < sql.length && identifierPart.test(sql[i])) ++i;
	            const text = sql.slice(start, i);
	            if (/^x$/i.test(text) && sql[i] === "'") {
	                const end = sql.indexOf("'", i + 1);
	                if (end < 0 || !/^(?:[0-9a-f]{2})*$/i.test(sql.slice(i + 1, end))) throw new Unsupported('invalid-blob', 'Invalid SQLite blob literal.');
	                tokens.push({kind: 'Blob', text: sql.slice(start, end + 1), value: sql.slice(i + 1, end).toUpperCase()}); i = end + 1;
	            } else tokens.push({kind: 'Word', text, value: text});
	        } else {
	            const number = /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sql.slice(i));
	            if (number) { i += number[0].length; tokens.push({kind: 'Number', text: number[0], value: number[0]}); }
	            else {
	                const op = /^(?:->>|->|<>|<=|>=|!=|==|\|\||<<|>>|[+*/%<>=!~&|^-])/.exec(sql.slice(i));
	                if (op) { i += op[0].length; tokens.push({kind: 'Operator', text: op[0], value: op[0]}); }
	                else if ('(),.;'.includes(sql[i])) { tokens.push({kind: 'Punctuation', text: sql[i], value: sql[i]}); ++i; }
	                else throw new Unsupported('unsupported-character', 'Unsupported SQL token at character ' + i + '.');
	            }
	        }
	    }
	    const stack = [];
	    for (const token of tokens) {
	        if (token.text === '(') stack.push(token);
	        if (token.text === ')' && !stack.pop()) throw new Unsupported('unbalanced-parentheses', 'SQL parentheses are unbalanced.');
	    }
	    if (stack.length) throw new Unsupported('unbalanced-parentheses', 'SQL parentheses are unbalanced.');
	    return tokens;
	}

	// SQLite accepts non-ASCII unquoted identifiers. Quote them only in the parser input;
	// their original spelling/value is retained in the syntax tree.
	const needsParserQuotes = token => token.kind === 'Word' && (/[^\x00-\x7f]/.test(token.text) || token.text.startsWith('_'));
	function parserSql(tokens) {
	    return tokens.map(t => needsParserQuotes(t)
	        ? '"' + t.text.replaceAll('"', '""') + '"' : t.text).join(' ');
	}

	function parseAst(sql) { return parser.astify(sql, {database: 'sqlite'}); }

	function tableColumns(schema) {
	    const map = new Map();
	    if (Array.isArray(schema?.tables)) {
	        for (const table of schema.tables) map.set(asciiFold(table.name), new Map((table.columns || []).map(c => [asciiFold(typeof c === 'string' ? c : c.name), typeof c === 'string' ? {} : c])));
	    } else if (schema && typeof schema === 'object') {
	        for (const [name, columns] of Object.entries(schema)) {
	            if (Array.isArray(columns)) map.set(asciiFold(name), new Map(columns.map(c => [asciiFold(typeof c === 'string' ? c : c.name), typeof c === 'string' ? {} : c])));
	        }
	    }
	    return map;
	}
	function schemaTables(schema) { return tableColumns(schema); }

	// This is a SQL AST adapter. It deliberately does not call normalizeAst or
	// syntaxTree: semantic equivalences belong to graph edges, not node equality.
	const fold$2 = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
	const upper$1 = value => typeof value === 'string' ? value.replace(/[a-z]/g, c => c.toUpperCase()) : value;
	const clone = value => JSON.parse(JSON.stringify(value));

	function stableKey(value) {
	    if (value === null || typeof value !== 'object') return JSON.stringify(value);
	    if (Array.isArray(value)) return '[' + value.map(stableKey).join(',') + ']';
	    if (typeof value.kind === 'string' && value.attrs && value.slots) {
	        value = {kind: value.kind,
	            attrs: Object.fromEntries(Object.entries(value.attrs).filter(([key, child]) => child != null && !(key === 'distinct' && child === false))),
	            slots: Object.fromEntries(Object.entries(value.slots).filter(([, child]) => child != null && !(Array.isArray(child) && !child.length)))};
	    }
	    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableKey(value[key])).join(',') + '}';
	}

	const word = token => token?.kind === 'Word' ? upper$1(token.value) : '';
	const isName = token => token && (token.kind === 'Word' || token.kind === 'Identifier');
	const is = (token, value) => token?.text === value || word(token) === value;
	const synthetic = text => lex(text);
	function validateNumericBoundaries(sql, tokens) {
	    let offset = 0;
	    for (const token of tokens) {
	        for (;;) {
	            if (/\s/.test(sql[offset] || '')) { offset++; continue; }
	            if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset); offset = end < 0 ? sql.length : end + 1; continue; }
	            if (sql.startsWith('/*', offset)) { offset = sql.indexOf('*/', offset + 2) + 2; continue; }
	            break;
	        }
	        offset += token.text.length;
	        if (token.kind === 'Number' && /[A-Za-z_\u0080-\uFFFF.$]/.test(sql[offset] || '')) {
	            throw new Unsupported('graph-invalid-numeric-token', 'A SQL numeric token is malformed.');
	        }
	    }
	}
	const one = ast => {
	    if (Array.isArray(ast)) {
	        if (ast.length !== 1) throw new Unsupported('graph-parser-statements', 'Expected one SQL statement.');
	        return ast[0];
	    }
	    return ast;
	};
	function splitAtDepth(tokens, predicate) {
	    const parts = []; let start = 0, depth = 0;
	    for (let i = 0; i < tokens.length; i++) {
	        if (is(tokens[i], '(')) depth++;
	        else if (is(tokens[i], ')')) depth--;
	        else if (!depth && predicate(tokens[i], i)) { parts.push(tokens.slice(start, i)); start = i + 1; }
	    }
	    parts.push(tokens.slice(start)); return parts;
	}
	function topLevel(tokens, predicate) {
	    let depth = 0;
	    for (let i = 0; i < tokens.length; i++) {
	        if (is(tokens[i], '(')) depth++;
	        else if (is(tokens[i], ')')) depth--;
	        else if (!depth && predicate(tokens[i], i)) return i;
	    }
	    return -1;
	}

	function context$1(tokens) {
	    let serial = 0;
	    // Include string contents too: a user literal must never be mistaken for a
	    // generated parser placeholder, even if it spells our internal prefix.
	    const used = new Set(tokens.filter(t => typeof t.value === 'string').map(t => fold$2(t.value)));
	    return {
	        markers: new Map(), adapters: new Set(), partial: false,
	        marker(type, value) {
	            let name;
	            do { name = '__qss_ast_marker_' + serial++ + '__'; } while (used.has(name));
	            used.add(name); this.markers.set(name, {type, value}); return name;
	        }
	    };
	}

	// Narrow grammar adapters retain native SQLite constructs in the AST. Marker
	// nodes are removed after parsing; no marker or source fragment becomes a node.
	function grammarInput(tokens, ctx) {
	    const result = [];
	    // The upstream parser converts numeric literals to JS Number, losing both
	    // SQLite's integer/real distinction and large-integer precision. Parameters
	    // are parser placeholders only: restore the original literal AST afterwards.
	    const typeParameters = new Set();
	    const parameterizedTypes = new Set(['CHAR', 'CHARACTER', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'DECIMAL', 'NUMERIC', 'NUMBER', 'FLOAT', 'DOUBLE', 'REAL', 'INTEGER', 'INT']);
	    for (let i = 0; i + 1 < tokens.length; i++) {
	        if (!parameterizedTypes.has(word(tokens[i])) || !is(tokens[i + 1], '(')) continue;
	        const ddl = word(tokens[0]) === 'ALTER' || word(tokens[0]) === 'CREATE' && tokens.slice(0, i).some(token => word(token) === 'TABLE');
	        const declaredType = ddl && isName(tokens[i - 1]) && !['DEFAULT', 'CHECK', 'SELECT', 'WHERE', 'AS', 'AND', 'OR'].includes(word(tokens[i - 1]));
	        if (word(tokens[i - 1]) !== 'AS' && !declaredType) continue;
	        let depth = 1;
	        for (let j = i + 2; j < tokens.length && depth; j++) {
	            if (is(tokens[j], '(')) depth++;
	            else if (is(tokens[j], ')')) depth--;
	            else if (tokens[j].kind === 'Number') typeParameters.add(j);
	        }
	    }
	    for (let i = 0; i < tokens.length; i++) {
	        const t = tokens[i], keyword = word(t);
	        if (t.kind === 'String' || t.kind === 'Identifier'
	            || t.kind === 'Word' && (/[^\x00-\x7f]/.test(t.text) || t.text.startsWith('_'))) {
	            const type = t.kind === 'String' ? 'string' : t.kind === 'Word' ? 'unquoted-name' : 'quoted-name';
	            const marker = ctx.marker(type, {value: t.value, quote: t.text[0]});
	            const quote = t.kind === 'String' ? "'" : '"';
	            result.push({kind: quote === "'" ? 'String' : 'Identifier', text: quote + marker + quote, value: marker});
	            continue;
	        }
	        if (t.kind === 'Number' && !typeParameters.has(i)) {
	            const real = /[.eE]/.test(t.text) && !/^0x/i.test(t.text)
	                || !/^0x/i.test(t.text) && BigInt(t.text) > 9223372036854775807n;
	            const marker = ctx.marker('number', {type: 'number', value: t.text,
	                storageClass: real ? 'real' : 'integer'});
	            result.push({kind: 'Parameter', text: ':' + marker, value: marker});
	            continue;
	        }
	        result.push(t);
	        if (keyword === 'REFERENCES' && isName(tokens[i + 1])) {
	            result.push(tokens[++i]);
	            if (is(tokens[i + 1], '.') && isName(tokens[i + 2])) result.push(tokens[++i], tokens[++i]);
	            if (!is(tokens[i + 1], '(')) {
	                const marker = ctx.marker('implicit-reference-columns', null);
	                result.push(...synthetic('(' + marker + ')'));
	                ctx.adapters.add('implicit-reference-columns');
	            }
	        } else if (keyword === 'IN' && isName(tokens[i + 1])
	            && !['SELECT', 'WITH', 'VALUES'].includes(word(tokens[i + 1]))) {
	            const first = tokens[++i];
	            let db = null, table = first.value;
	            if (is(tokens[i + 1], '.') && isName(tokens[i + 2])) { db = table; ++i; table = tokens[++i].value; }
	            const marker = ctx.marker('table-membership', {type: 'table_membership', db, table});
	            result.push(...synthetic('(' + marker + ')'));
	            ctx.adapters.add('table-membership');
	        } else if (['AVG', 'SUM', 'MIN', 'MAX'].includes(keyword)
	            && is(tokens[i + 1], '(') && is(tokens[i + 2], ')')) {
	            const marker = ctx.marker('hole', null);
	            result.push(tokens[++i], ...synthetic(marker), tokens[++i]);
	            ctx.partial = true;
	        }
	    }
	    return result;
	}

	function restoreMarkers(value, ctx) {
	    if (value === null || typeof value !== 'object') {
	        const marker = typeof value === 'string' ? ctx.markers.get(value) : null;
	        return marker && ['string', 'quoted-name', 'unquoted-name'].includes(marker.type) ? marker.value.value : value;
	    }
	    if (Array.isArray(value)) return value.map(v => restoreMarkers(v, ctx));
	    const markerName = value.type === 'column_ref' ? value.column : value.value;
	    if (typeof markerName === 'string' && ctx.markers.has(markerName)) {
	        const marker = ctx.markers.get(markerName);
	        if (marker.type === 'hole') return null;
	        if (marker.type === 'number') return clone(marker.value);
	        if (['string', 'quoted-name', 'unquoted-name'].includes(marker.type)) {
	            if (value.type === 'column_ref') {
	                return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
	                    key === 'column' ? marker.value.value : restoreMarkers(child, ctx)]));
	            }
	            if (marker.type === 'unquoted-name' || marker.type === 'quoted-name' && marker.value.quote !== '"') {
	                return {type: 'column_ref', table: null, column: marker.value.value, collate: null};
	            }
	            return {...value, value: marker.value.value};
	        }
	        return {type: '__marker', marker: markerName};
	    }
	    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, restoreMarkers(child, ctx)]));
	    if (result.type === 'select' && result.columns?.length === 1 && result.columns[0].expr?.type === '__marker') {
	        const marker = ctx.markers.get(result.columns[0].expr.marker);
	        if (marker?.type === 'subquery') return clone(marker.value);
	    }
	    if (result.type === 'expr_list' && result.value?.length === 1 && result.value[0]?.type === '__marker') {
	        const marker = ctx.markers.get(result.value[0].marker);
	        if (marker.type === 'table-membership') return clone(marker.value);
	    }
	    if (Array.isArray(result.definition) && result.definition.length === 1 && result.definition[0]?.type === '__marker'
	        && ctx.markers.get(result.definition[0].marker)?.type === 'implicit-reference-columns') {
	        result.definition = null;
	        result.implicit_columns = true;
	    }
	    return result;
	}

	function parseStatement(original, ctx) {
	    const tokens = grammarInput(original, ctx);
	    try { return restoreMarkers(one(parseAst(parserSql(tokens))), ctx); }
	    catch (initialError) {
	        // SQLite's compound SELECT operators have equal precedence and associate
	        // to the left. This constructs their real SQL AST, not a syntax tree.
	        const operators = [];
	        let depth = 0;
	        for (let i = 0; i < original.length; i++) {
	            if (is(original[i], '(')) depth++;
	            else if (is(original[i], ')')) depth--;
	            else if (!depth && ['UNION', 'EXCEPT', 'INTERSECT'].includes(word(original[i]))) operators.push(i);
	        }
	        if (word(original[0]) === 'SELECT' && operators.length) {
	            const index = operators.at(-1), all = word(original[index + 1]) === 'ALL';
	            const result = {type: 'compound_select', operator: word(original[index]) + (all ? ' ALL' : ''),
	                left: parseStatement(original.slice(0, index), ctx), right: parseStatement(original.slice(index + 1 + Number(all)), ctx)};
	            ctx.adapters.add('compound-select'); return liftCompoundTail(result);
	        }
	        // The parser rejects mixed comma/explicit JOIN chains that SQLite
	        // accepts. Parse each comma-delimited source with its JOINs independently.
	        if (word(original[0]) === 'SELECT') {
	            const from = topLevel(original, token => word(token) === 'FROM');
	            if (from >= 0) {
	                const relativeEnd = topLevel(original.slice(from + 1), token => ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT'].includes(word(token)));
	                const end = relativeEnd < 0 ? original.length : from + 1 + relativeEnd;
	                const groups = splitAtDepth(original.slice(from + 1, end), token => is(token, ','));
	                if (groups.length > 1 && groups.every(group => group.length)) {
	                    const sources = groups.flatMap(group => parseStatement([...synthetic('SELECT 1 FROM'), ...group], ctx).from || []);
	                    const placeholder = ctx.marker('table-placeholder', null);
	                    const shell = parseStatement([...original.slice(0, from + 1), ...synthetic(placeholder), ...original.slice(end)], ctx);
	                    shell.from = sources; ctx.adapters.add('mixed-join-sources'); return shell;
	                }
	            }
	            // SQLite also supports the postfix expression spelling `x NOT NULL`.
	            // Its semantic expression AST is the same IS NOT NULL operator.
	            const patched = [];
	            let changed = false;
	            for (let i = 0; i < original.length; i++) {
	                if (word(original[i]) === 'NOT' && word(original[i + 1]) === 'NULL'
	                    && i > 0 && word(original[i - 1]) !== 'IS'
	                    && (isName(original[i - 1]) || is(original[i - 1], ')') || ['Number', 'String'].includes(original[i - 1].kind))) {
	                    patched.push(...synthetic('IS')); changed = true;
	                }
	                patched.push(original[i]);
	            }
	            if (changed) { const result = parseStatement(patched, ctx); ctx.adapters.add('postfix-not-null'); return result; }
	        }
	        // CREATE VIEW contains an ordinary SELECT AST; parse that child using
	        // the same adapters and retain the complete native view declaration.
	        if (word(original[0]) === 'CREATE' && original.some(token => word(token) === 'VIEW')) {
	            const as = topLevel(original, (token, i) => word(token) === 'AS' && ['SELECT', 'WITH'].includes(word(original[i + 1])));
	            if (as >= 0) {
	                const shell = one(parseAst(parserSql([...original.slice(0, as + 1), ...synthetic('SELECT 1')])));
	                shell.select = parseStatement(original.slice(as + 1), ctx);
	                return shell;
	            }
	        }
	        // The upstream grammar accepts some SELECT expressions at the top
	        // level but rejects the same expressions in IN/scalar subqueries of
	        // DELETE/UPDATE. Parse each real query child independently, retain the
	        // enclosing SQL AST, and replace only its temporary parser placeholder.
	        // Parentheses and query boundaries come from the balanced SQLite lexer.
	        const shellTokens = []; let extracted = false;
	        for (let i = 0; i < original.length; i++) {
	            if (!is(original[i], '(') || !['SELECT', 'WITH'].includes(word(original[i + 1]))) {
	                shellTokens.push(original[i]); continue;
	            }
	            let depth = 1, end = i + 1;
	            for (; end < original.length && depth; end++) {
	                if (is(original[end], '(')) depth++;
	                else if (is(original[end], ')')) depth--;
	            }
	            const content = original.slice(i + 1, end - 1);
	            // Re-entering the outer parser may still need another adapter, but
	            // must not repeatedly extract an already opaque query placeholder.
	            if (content.length === 2 && word(content[0]) === 'SELECT'
	                && content[1].kind === 'Parameter' && ctx.markers.get(content[1].value)?.type === 'subquery') {
	                shellTokens.push(...original.slice(i, end)); i = end - 1; continue;
	            }
	            const child = parseStatement(content, ctx), marker = ctx.marker('subquery', child);
	            shellTokens.push(original[i], ...synthetic('SELECT'), {kind: 'Parameter', text: ':' + marker, value: marker}, original[end - 1]);
	            i = end - 1; extracted = true;
	        }
	        if (extracted) {
	            const result = parseStatement(shellTokens, ctx);
	            ctx.adapters.add('nested-query-ast'); return result;
	        }
	        throw new Unsupported('graph-sql-grammar', 'The SQL cannot be represented by the semantic graph AST adapter.');
	    }
	}

	function liftCompoundTail(compound) {
	    let last = compound.right;
	    while (last?.type === 'compound_select') last = last.right;
	    for (const key of ['orderby', 'limit']) {
	        if (last?.[key] != null) { compound[key] = last[key]; last[key] = null; }
	    }
	    return compound;
	}

	const kinds = {
	    select: 'Select', compound_select: 'CompoundSelect', binary_expr: 'BinaryExpression', unary_expr: 'UnaryExpression',
	    column_ref: 'ColumnReference', number: 'NumberLiteral', bigint: 'BigIntLiteral', bool: 'BooleanLiteral',
	    string: 'StringLiteral', single_quote_string: 'StringLiteral', double_quote_string: 'DoubleQuotedLiteral',
	    null: 'NullLiteral', star: 'Asterisk', aggr_func: 'AggregateExpression', function: 'FunctionExpression',
	    expr_list: 'ExpressionList', table_membership: 'TableMembership', case: 'CaseExpression', when: 'WhenExpression',
	    create: 'Create', alter: 'Alter', update: 'Update', delete: 'Delete', insert: 'Insert', drop: 'Drop',
	    values: 'Values', cast: 'CastExpression', default: 'Default', 'not null': 'NotNull'
	};
	const listFields = new Set(['columns', 'from', 'with', 'orderby', 'options', 'create_definitions', 'table_options', 'on_action', 'set', 'returning']);
	const childFields = new Set(['expr', 'left', 'right', 'where', 'having', 'groupby', 'limit', 'for_update', 'over',
	    'collate', 'args', 'ast', 'select', 'definition', 'reference_definition', 'column', 'name', 'using',
	    'window', 'partitionby', 'on', 'check', 'nullable', 'default_val']);
	const ignored = new Set(['loc', 'tableList', 'columnList', 'parentheses']);
	const enumFields = new Set(['operator', 'join', 'dataType', 'keyword', 'constraint_type', 'resource', 'action', 'primary_key']);
	const identifierFields = new Set(['table', 'db', 'column', 'as', 'view', 'index', 'constraint']);

	function wrapperKind(raw, field, parentKind) {
	    if (raw.ast) return 'Subquery';
	    if (field === 'columns' && parentKind === 'Select') return 'SelectItem';
	    if (field === 'from' || field === 'table') return 'TableSource';
	    if (field === 'orderby') return 'OrderByItem';
	    if (field === 'groupby') return 'GroupBy';
	    if (field === 'args' && parentKind === 'AggregateExpression') return 'AggregateArguments';
	    if (field === 'args') return 'FunctionArguments';
	    if (field === 'create_definitions' || (field === 'expr' && parentKind === 'Alter')) return 'Definition';
	    if (field === 'definition' && raw.dataType) return 'DataType';
	    if (field === 'reference_definition') return 'ReferenceDefinition';
	    if (field === 'view') return 'ViewName';
	    if (field === 'name' && parentKind === 'FunctionExpression') return 'FunctionName';
	    if (field === 'with') return 'CommonTableExpression';
	    if (field === 'set') return 'Assignment';
	    return field ? field[0].toUpperCase() + field.slice(1) : 'SQLComponent';
	}

	function toNode(input, field = '', parentKind = '') {
	    if (input == null) return null;
	    if (typeof input !== 'object') return {kind: 'Scalar', attrs: {value: input}, slots: {}};
	    if (Array.isArray(input)) throw new Unsupported('graph-model-list', 'A SQL node cannot be an unbound list.');
	    let raw = input;
	    if (raw.type === '__marker') throw new Unsupported('graph-parser-marker', 'An internal SQL parser marker was not consumed.');
	    // Upstream select_stmt -> '(' select_stmt ')' marks parentheses_symbol for
	    // SQL rendering. A Subquery.ast child is already explicitly enclosed by its
	    // semantic parent. Retaining this duplicate flag would charge an extra edit
	    // when the parser chooses a different scalar-subquery grammar branch.
	    // Do not drop it globally: compound/grouping contexts keep their structure,
	    // and ORDER BY/LIMIT remain attached to their actual query scope.
	    if (raw.type === 'select' && field === 'ast' && parentKind === 'Subquery'
	        && typeof raw.parentheses_symbol === 'boolean') {
	        raw = {...raw}; delete raw.parentheses_symbol;
	    }
	    // node-sql-parser encodes these SQL prefix operators as named functions.
	    // Preserve their actual expression role without applying an equivalence.
	    const functionName = raw.type === 'function' && raw.name?.name?.length === 1 ? upper$1(raw.name.name[0].value) : null;
	    if (['NOT', 'EXISTS'].includes(functionName) && raw.args?.value?.length === 1) {
	        raw = {type: 'unary_expr', operator: functionName, expr: raw.args.value[0]};
	    }
	    if (raw.type === 'select' && raw._next) {
	        let current = clone(raw), result;
	        const first = current;
	        while (current) {
	            const next = current._next, operator = current.set_op;
	            delete current._next; delete current.set_op;
	            if (!result) result = current;
	            else result = {type: 'compound_select', operator: upper$1(result.__pendingOperator), left: result, right: current};
	            // Internal temporary bookkeeping never enters the semantic model.
	            delete result.left?.__pendingOperator;
	            if (next) result.__pendingOperator = operator;
	            current = next;
	        }
	        delete result.__pendingOperator;
	        if (first.with) { result.with = first.with; first.with = null; }
	        raw = liftCompoundTail(result);
	    }
	    const kind = field === 'orderby' ? 'OrderByItem' : kinds[raw.type]
	        || (typeof raw.type === 'string' ? 'SQL:' + raw.type : wrapperKind(raw, field, parentKind));
	    const node = {kind, attrs: {}, slots: {}};
	    if (kind === 'Select') node.attrs.distinct = raw.distinct === 'DISTINCT' || upper$1(raw.distinct?.type) === 'DISTINCT';
	    if (kind === 'AggregateArguments') node.attrs.distinct = raw.distinct === 'DISTINCT' || upper$1(raw.distinct?.type) === 'DISTINCT';
	    for (const [key, value] of Object.entries(raw)) {
	        if (ignored.has(key) || key === 'type' && kind !== 'OrderByItem' || key === 'distinct' && ['Select', 'AggregateArguments'].includes(kind)) continue;
	        if (Array.isArray(value)) node.slots[key] = value.map(child => toNode(child, key, kind));
	        else if (value && typeof value === 'object') node.slots[key] = toNode(value, key, kind);
	        else if (value == null && (listFields.has(key) || childFields.has(key))) node.slots[key] = listFields.has(key) ? [] : null;
	        else {
	            let scalar = value;
	            if (typeof scalar === 'string' && (identifierFields.has(key) || kind === 'Collate' && key === 'name')) scalar = fold$2(scalar);
	            if (typeof scalar === 'string' && (enumFields.has(key) || kind === 'OrderByItem' && key === 'type'
	                || kind === 'AggregateExpression' && key === 'name'
	                || parentKind === 'FunctionName' && key === 'value')) scalar = upper$1(scalar);
	            node.attrs[key] = scalar;
	        }
	    }
	    if (kind === 'Select') {
	        for (const key of ['columns', 'from', 'with', 'orderby', 'options']) node.slots[key] ||= [];
	        for (const key of ['where', 'groupby', 'having', 'limit', 'for_update']) node.slots[key] ??= null;
	    }
	    if (kind === 'AggregateArguments') node.slots.expr ??= null;
	    if (kind === 'BinaryExpression') { node.slots.left ??= null; node.slots.right ??= null; }
	    if (kind === 'UnaryExpression') node.slots.expr ??= null;
	    if (kind === 'TableSource') {
	        for (const key of ['db', 'table', 'as', 'join']) node.attrs[key] ??= null;
	        for (const key of ['on', 'expr', 'using']) node.slots[key] ??= null;
	    }
	    if (kind === 'ColumnReference') {
	        node.attrs.table ??= null;
	        node.slots.collate ??= null;
	    }
	    if (kind === 'SelectItem') { node.attrs.as ??= null; node.slots.expr ??= null; }
	    // Omitted ORDER BY direction is the same SQLite grammar default as ASC;
	    // serializers may spell it out without changing the ordering operation.
	    if(kind==='OrderByItem')node.attrs.type=upper$1(node.attrs.type||'ASC');
	    if (kind === 'AggregateExpression') { node.slots.args ??= null; node.slots.over ??= null; }
	    return node;
	}

	// SQLite first interprets a double-quoted expression as an identifier. Only an
	// unresolved name receives legacy DQS string fallback. This is name resolution
	// in the supplied schema, not an equivalence rewrite or an execution probe.
	function resolveDoubleQuotedNames(root, schema) {
	    const catalog = new Map();
	    const addTable = (name, columns) => {
	        if (typeof name !== 'string' || !Array.isArray(columns)) return;
	        catalog.set(fold$2(name), new Set(columns.map(column => fold$2(typeof column === 'string' ? column : column.name))
	            .filter(name => typeof name === 'string')));
	    };
	    if (Array.isArray(schema?.tables)) for (const table of schema.tables) addTable(table.name, table.columns);
	    else if (schema && typeof schema === 'object') for (const [name, columns] of Object.entries(schema)) addTable(name, columns);
	    const outputNames = (query,tables=catalog) => {
	        if (query?.kind === 'Subquery') return outputNames(query.slots.ast,tables);
	        if (query?.kind === 'CompoundSelect') return outputNames(query.slots.left,tables);
	        const result = new Set();
	        if (query?.kind !== 'Select') return result;
	        for (const item of query.slots.columns || []) {
	            if (typeof item?.attrs?.as === 'string') result.add(fold$2(item.attrs.as));
	            else if (item?.slots?.expr?.kind === 'ColumnReference' && item.slots.expr.attrs.column !== '*') result.add(fold$2(item.slots.expr.attrs.column));
	            else if(item?.slots?.expr?.kind==='Asterisk'||item?.slots?.expr?.kind==='ColumnReference'&&item.slots.expr.attrs.column==='*'){
	                const qualifier=item.slots.expr.attrs.table;
	                for(const source of query.slots.from||[])if(qualifier==null||fold$2(source.attrs.as??source.attrs.table)===fold$2(qualifier))
	                    for(const name of source.slots.expr?outputNames(source.slots.expr,tables):tables.get(fold$2(source.attrs.table))||[])result.add(name);
	            }
	        }
	        return result;
	    };
	    const matches = (name, scope, aliases) => {
	        for (let current = scope; current; current = current.parent) {
	            if (current.sources.some(columns => columns.has(name))) return true;
	            if (current === scope && aliases && current.aliases.has(name)) return true;
	        }
	        return false;
	    };
	    const resolve = (node, scope, tables, aliases = false) => {
	        if (!node) return node;
	        if(node.kind==='Script'){
	            const local=new Map(tables);
	            node.slots.statements=(node.slots.statements||[]).map(statement=>{
	                const result=resolve(statement,null,local);
	                const name=fold$2(result.slots.table?.[0]?.attrs.table);
	                if(result.kind==='Create'&&result.attrs.keyword==='TABLE'&&typeof name==='string'){
	                    const columns=(result.slots.create_definitions||[]).filter(d=>d.attrs.resource==='COLUMN').map(d=>fold$2(d.slots.column?.attrs.column)).filter(n=>typeof n==='string');
	                    local.set(name,columns.length?new Set(columns):outputNames(result.slots.select,local));
	                }else if(result.kind==='Create'&&result.attrs.keyword==='VIEW'){
	                    const view=fold$2(result.slots.view?.attrs.view),explicit=(result.slots.columns||[]).map(c=>fold$2(c.attrs.column??c.attrs.value)).filter(n=>typeof n==='string');
	                    if(typeof view==='string')local.set(view,explicit.length?new Set(explicit):outputNames(result.slots.select,local));
	                }else if(result.kind==='Alter'&&local.has(name)){
	                    const columns=new Set(local.get(name));
	                    for(const action of result.slots.expr||[]){
	                        const column=fold$2(action.slots.column?.attrs.column);
	                        if(action.attrs.resource!=='COLUMN')continue;
	                        if(['ADD','RENAME'].includes(action.attrs.action)&&typeof column==='string')columns.add(column);
	                        if(action.attrs.action==='DROP')columns.delete(column);
	                        if(action.attrs.action==='RENAME')columns.delete(fold$2(action.slots.old_column?.attrs.column));
	                    }local.set(name,columns);
	                }else if(result.kind==='Drop'&&['TABLE','VIEW'].includes(result.attrs.keyword))local.delete(name);
	                return result;
	            });return node;
	        }
	        if(node.kind==='Create'&&node.attrs.keyword==='TABLE'){
	            const columns=new Set((node.slots.create_definitions||[]).filter(d=>d.attrs.resource==='COLUMN').map(d=>fold$2(d.slots.column?.attrs.column)).filter(n=>typeof n==='string'));
	            const checkScope={parent:null,sources:[columns],aliases:new Set()};
	            const definitions=n=>{
	                for(const [field,value]of Object.entries(n.slots)){
	                    const child=v=>field==='check'?resolve(v,checkScope,tables):v&&v.kind==='Definition'?definitions(v):resolve(v,null,tables);
	                    n.slots[field]=Array.isArray(value)?value.map(child):child(value);
	                }return n;
	            };
	            node.slots.create_definitions=(node.slots.create_definitions||[]).map(definitions);
	            if(node.slots.select)node.slots.select=resolve(node.slots.select,null,tables);
	            return node;
	        }
	        if(node.kind==='Alter'){
	            const columns=new Set(tables.get(fold$2(node.slots.table?.[0]?.attrs.table))||[]);
	            for(const action of node.slots.expr||[]){
	                if(action.attrs.resource==='COLUMN'&&action.attrs.action==='ADD'){
	                    const name=fold$2(action.slots.column?.attrs.column);
	                    if(typeof name==='string')columns.add(name);
	                }
	            }
	            const checkScope={parent:null,sources:[columns],aliases:new Set()};
	            for(const action of node.slots.expr||[])for(const [field,value]of Object.entries(action.slots)){
	                // CHECK sees existing and newly declared columns. DEFAULT keeps
	                // its independent constant-expression/DQS context.
	                const child=v=>resolve(v,field==='check'?checkScope:null,tables);
	                action.slots[field]=Array.isArray(value)?value.map(child):child(value);
	            }
	            return node;
	        }
	        if(node.kind==='Update'||node.kind==='Delete'){
	            const sources=(node.slots.table||node.slots.from||[]).map(s=>tables.get(fold$2(s.attrs.table))||new Set());
	            const current={parent:scope,sources,aliases:new Set()};
	            for(const [field,value]of Object.entries(node.slots)){
	                node.slots[field]=Array.isArray(value)?value.map(child=>resolve(child,current,tables)):resolve(value,current,tables);
	            }return node;
	        }
	        if (node.kind === 'Select' || node.kind === 'CompoundSelect') {
	            const local = new Map(tables);
	            const ctes = node.slots.with || [];
	            const cteName = cte => fold$2(cte?.slots?.name?.attrs?.value ?? cte?.attrs?.name);
	            // A CTE shadows a global relation even when its output is unknown.
	            for (const cte of ctes) if (typeof cteName(cte) === 'string') local.set(cteName(cte), new Set());
	            for (const cte of ctes) {
	                cte.slots.stmt = resolve(cte.slots.stmt, null, local);
	                const explicit = (cte.slots.columns || []).map(column => fold$2(column?.attrs?.column)).filter(name => typeof name === 'string');
	                if (typeof cteName(cte) === 'string') local.set(cteName(cte), explicit.length ? new Set(explicit) : outputNames(cte.slots.stmt,local));
	            }
	            if (node.kind === 'CompoundSelect') {
	                for (const [field, value] of Object.entries(node.slots)) {
	                    if (field === 'with' || field === 'orderby') continue;
	                    node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, scope, local)) : resolve(value, scope, local);
	                }
	                // Compound ORDER BY can name an output column or alias from
	                // either arm. It has no ordinary FROM scope of its own.
	                const names=query=>query?.kind==='CompoundSelect'
	                    ?new Set([...names(query.slots.left),...names(query.slots.right)]):outputNames(query,local);
	                const orderScope={parent:scope,sources:[names(node)],aliases:new Set()};
	                node.slots.orderby=(node.slots.orderby||[]).map(item=>resolve(item,orderScope,local));
	                return node;
	            }
	            const sources = [];
	            for (const source of node.slots.from || []) {
	                // Ordinary FROM subqueries are not lateral; do not capture an
	                // enclosing query merely because a global column has that name.
	                if (source.slots.expr) {
	                    source.slots.expr = resolve(source.slots.expr, null, local);
	                    sources.push(outputNames(source.slots.expr,local));
	                } else sources.push(local.get(fold$2(source.attrs.table)) || new Set());
	            }
	            const current = {parent: scope, sources,
	                aliases: new Set((node.slots.columns || []).map(item => fold$2(item?.attrs?.as)).filter(name => typeof name === 'string'))};
	            for (const [field, value] of Object.entries(node.slots)) {
	                if (field === 'with' || field === 'from') continue;
	                const useAliases = field !== 'columns';
	                node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, current, local, useAliases)) : resolve(value, current, local, useAliases);
	            }
	            for (const source of node.slots.from || []) {
	                source.slots.on = resolve(source.slots.on, current, local, true);
	            }
	            return node;
	        }
	        if (node.kind === 'DoubleQuotedLiteral' && scope && matches(fold$2(node.attrs.value), scope, aliases)) {
	            const slots = {...node.slots, collate: node.slots.collate ?? null};
	            const suffix = slots.suffix;
	            // The parser stores a literal's postfix COLLATE under `suffix`, but
	            // a column's identical postfix under `collate`. Keep that operator
	            // attached to the resolved expression in the column grammar role.
	            if (slots.collate === null && suffix?.slots?.collate
	                && Object.values(suffix.attrs).every(value => value == null)
	                && Object.entries(suffix.slots).every(([field, value]) => field === 'collate' || value == null || Array.isArray(value) && !value.length)) {
	                slots.collate = suffix.slots.collate; delete slots.suffix;
	            }
	            node = {kind: 'ColumnReference', attrs: {table: null, column: fold$2(node.attrs.value)}, slots};
	        }
	        for (const [field, value] of Object.entries(node.slots)) {
	            node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, scope, tables, aliases)) : resolve(value, scope, tables, aliases);
	        }
	        return node;
	    };
	    return resolve(root, null, catalog);
	}

	/**
	 * Build semantic SQL states for the implicit edit graph, including incomplete or
	 * non-executable states. The supplied schema resolves SQLite DQS identifier vs
	 * string interpretation; semantic equivalences remain edits. No SQL is run here.
	 */
	function parseGraphSql(sql, {schema, allowEmpty = false} = {}) {
	    const tokens = lex(sql), ctx = context$1(tokens);
	    validateNumericBoundaries(sql, tokens);
	    if (!tokens.length && !allowEmpty) throw new Unsupported('empty-reference', 'The graph reference SQL is empty.');
	    const statements = splitAtDepth(tokens, token => is(token, ';')).filter(part => part.length)
	        .map(part => toNode(parseStatement(part, ctx)));
	    return {root: resolveDoubleQuotedNames({kind: 'Script', attrs: {}, slots: {statements}}, schema),
	        validation: ctx.partial ? 'partial-sql-ast' : ctx.adapters.size ? 'sqlite-dialect-ast' : 'strict-sql-ast',
	        adapters: [...ctx.adapters].sort()};
	}

	/** Small, proof-oriented SQL equivalences. No SQL/result similarity scoring. */
	const MAX = 9223372036854775807n, MIN = -9223372036854775808n;
	const comparisonComplements = {'=':'!=','==':'!=','!=':'=','<>':'=','>':'<=','<':'>=','>=':'<','<=':'>'};
	const boolExpression = n => n?.kind === 'BooleanLiteral'
	    || n?.kind === 'BinaryExpression' && ['=','==','!=','<>','>','<','>=','<=','IS','IS NOT','AND','OR','LIKE','NOT LIKE','IN','NOT IN'].includes(n.attrs.operator)
	    || n?.kind === 'UnaryExpression' && n.attrs.operator === 'NOT';
	const binaryExpression = (operator,left,right) => ({kind:'BinaryExpression',attrs:{operator},slots:{left,right}});
	const notExpression = expr => ({kind:'UnaryExpression',attrs:{operator:'NOT'},slots:{expr}});
	const deterministicNames=new Set(['STDEV','VARIANCE','ROUND','ABS','LENGTH','LOWER','UPPER','COALESCE','IFNULL','NULLIF',
	    'TRIM','LTRIM','RTRIM','SUBSTR','SUBSTRING','INSTR','HEX','QUOTE','TYPEOF','UNICODE','CHAR','REPLACE']);
	function deterministicFunction(node){
	    const parts=node?.slots?.name?.slots?.name;
	    return node?.kind==='FunctionExpression'&&parts?.length===1&&typeof parts[0].attrs.value==='string'
	        &&deterministicNames.has(parts[0].attrs.value.toUpperCase());
	}
	/** Deterministic scalar forms; calls, queries and opaque origins stay excluded. */
	function pureExpression(n){
	    if(!n)return false;
	    if(['NumberLiteral','StringLiteral','NullLiteral','BooleanLiteral','BigIntLiteral','ColumnReference'].includes(n.kind))return true;
	    if(n.kind==='UnaryExpression')return ['NOT','+','-','~'].includes(n.attrs.operator)&&pureExpression(n.slots.expr);
	    if(n.kind==='BinaryExpression')return !n.attrs.collate&&pureExpression(n.slots.left)&&pureExpression(n.slots.right);
	    if(n.kind==='ExpressionList')return (n.slots.value||[]).every(pureExpression);
	    if(n.kind==='CaseExpression')return (n.slots.expr==null||pureExpression(n.slots.expr))&&(n.slots.args||[]).every(pureExpression);
	    if(n.kind==='WhenExpression')return pureExpression(n.slots.cond)&&pureExpression(n.slots.result);
	    if(n.kind==='SQL:else')return pureExpression(n.slots.result);
	    if(n.kind==='CastExpression')return pureExpression(n.slots.expr);
	    return false;
	}
	const cleanSlots = (n, fields) => Object.entries(n.slots).every(([k,v]) => fields.includes(k) || v == null || Array.isArray(v) && !v.length);
	const cleanAttrs = (n,fields) => Object.entries(n.attrs).every(([k,v]) => fields.includes(k) || v == null);

	function exactInteger(node) {
	    if (!node) return null;
	    if (node.kind === 'NumberLiteral' && node.attrs.storageClass === 'integer'
	        && cleanAttrs(node,['value','storageClass']) && cleanSlots(node,[])) {
	        try {
	            const text=String(node.attrs.value);
	            if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(text)) return null;
	            let n=BigInt(text);
	            if (/^0x/i.test(text)) { if(n>18446744073709551615n)return null; n=BigInt.asIntN(64,n); }
	            return n>=MIN && n<=MAX ? n : null;
	        } catch { return null; }
	    }
	    if (node.kind === 'UnaryExpression' && ['+','-','~'].includes(node.attrs.operator)
	        && cleanAttrs(node,['operator']) && cleanSlots(node,['expr'])) {
	        const a=exactInteger(node.slots.expr);if(a===null)return null;
	        const n=node.attrs.operator==='-'?-a:node.attrs.operator==='~'?~a:a;
	        return n>=MIN&&n<=MAX?n:null;
	    }
	    if (node.kind !== 'BinaryExpression' || !['+','-','*','%','&','|'].includes(node.attrs.operator)
	        || !cleanAttrs(node,['operator']) || !cleanSlots(node,['left','right'])) return null;
	    const a=exactInteger(node.slots.left),b=exactInteger(node.slots.right);if(a===null||b===null)return null;
	    let n;
	    switch(node.attrs.operator){case '+':n=a+b;break;case '-':n=a-b;break;case '*':n=a*b;break;
	        case '%':if(b===0n)return null;n=a%b;break;case '&':n=a&b;break;case '|':n=a|b;break;}
	    // SQLite promotes overflowing integer arithmetic to REAL. Never fold that
	    // promotion or turn a division-by-zero NULL into a numeric constant.
	    return n>=MIN&&n<=MAX?n:null;
	}

	function decodedBooleanCase(n, key=stableKey) {
	    if(n?.kind!=='CaseExpression'||n.slots.expr!=null||!cleanAttrs(n,[])||!cleanSlots(n,['expr','args']))return null;
	    const a=n.slots.args;if(!Array.isArray(a)||a.length!==3)return null;
	    const first=a[0],second=a[1],last=a[2];
	    if(first?.kind!=='WhenExpression'||second?.kind!=='WhenExpression'||last?.kind!=='SQL:else'
	        ||!cleanAttrs(first,[])||!cleanAttrs(second,[])||!cleanAttrs(last,[])
	        ||!cleanSlots(first,['cond','result'])||!cleanSlots(second,['cond','result'])||!cleanSlots(last,['result'])
	        ||exactInteger(first.slots.result)!==1n||exactInteger(second.slots.result)!==0n
	        ||last.slots.result?.kind!=='NullLiteral'||!boolExpression(first.slots.cond)
	        ||key(second.slots.cond)!==key(notExpression(first.slots.cond)))return null;
	    return first.slots.cond;
	}

	function canonicalCount(node) {
	    if(node?.kind!=='AggregateExpression'||node.attrs.name!=='COUNT'||!node.slots.args?.slots||node.slots.args.attrs?.distinct)return null;
	    const arg=node.slots.args.slots.expr;
	    if(arg?.kind!=='Asterisk'&&exactInteger(arg)!==1n)return null;
	    return {...node,slots:{...node.slots,args:{...node.slots.args,slots:{...node.slots.args.slots,
	        expr:{kind:'Asterisk',attrs:{value:'*'},slots:{}}}}}};
	}

	function encodedBooleanCase(n) {
	    const num=value=>({kind:'NumberLiteral',attrs:{value:String(value),storageClass:'integer'},slots:{}});
	    const when=(cond,result)=>({kind:'WhenExpression',attrs:{},slots:{cond,result}});
	    return {kind:'CaseExpression',attrs:{},slots:{expr:null,args:[when(n,num(1)),when(notExpression(n),num(0)),
	        {kind:'SQL:else',attrs:{},slots:{result:{kind:'NullLiteral',attrs:{value:null},slots:{}}}}]}};
	}

	/** Explicit construct requirements, never inferred merely from the model SQL. */
	function questionRequirements(text = '') {
	    const plain=String(text).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
	    const forbidden=[],required=[];
	    if(/\bohne\s+(?:eine?\s+)?join(?:[-\s]operation(?:en)?)?\b|\bwithout\s+(?:any\s+)?joins?\b/i.test(plain))forbidden.push('join');
	    if(/durch.{0,100}(?:zwei|vereinigte).{0,100}left\s+(?:outer\s+)?join.{0,100}nachbauen/i.test(plain))required.push('left-join','union');
	    const label=plain.match(/welche\s+werte.{0,40}\bin\s+([\wäöüÄÖÜ]+).{0,30}unerheblich/i);
	    const freeLabels=label?[label[1].replace(/[A-Z]/g,c=>c.toLowerCase())]:[];
	    const freeDiagnostics=freeLabels.length>0&&/drittes\s+tupel.{0,160}(?:z\.?\s*b\.?|zum beispiel).{0,80}union\s+select/i.test(plain);
	    return {forbidden,required,freeLabels,freeDiagnostics};
	}
	function constructUse(root) {
	    const result={join:false,'left-join':false,union:false};
	    const visit=n=>{
	        if(!n?.kind)return;
	        if(n.kind==='Select'&&(n.slots.from||[]).length>1)result.join=true;
	        if(n.kind==='TableSource'&&n.attrs.join){result.join=true;if(/^LEFT(?: OUTER)? JOIN$/.test(n.attrs.join))result['left-join']=true;}
	        if(n.kind==='CompoundSelect'&&/^UNION/.test(n.attrs.operator))result.union=true;
	        for(const v of Object.values(n.slots))for(const child of Array.isArray(v)?v:[v])visit(child);
	    };visit(root);return result;
	}
	function requirementState(root, requirements) {
	    const used=constructUse(root);
	    return JSON.stringify([...(requirements?.forbidden||[]).map(k=>Boolean(used[k])),...(requirements?.required||[]).map(k=>!used[k])]);
	}

	/**
	 * Abstract facts for admissible search bounds. They are never graph nodes,
	 * grades, a query-equivalence decision, or a replacement for SQL edit paths.
	 * Zero-priced graph edges preserve both sets. Predicate/expression facts need
	 * a BINARY missing-fact bound: one paid binding edit can change many of them.
	 */

	const isNode$1 = node => Boolean(node && typeof node.kind === 'string' && node.attrs && node.slots);
	const kind$1 = (node, name) => node?.kind === name;
	const fold$1 = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
	const literalKinds$1 = new Set(['NumberLiteral', 'StringLiteral', 'DoubleQuotedLiteral', 'NullLiteral', 'BlobLiteral', 'BooleanLiteral', 'BigIntLiteral']);
	const comparisons = new Set(['=', '==', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IS NOT', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN']);
	const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '>': '<', '<': '>', '>=': '<=', '<=': '>='};
	const outerJoin = value => typeof value === 'string' && /^(?:LEFT|RIGHT|FULL)(?: OUTER)? JOIN$/.test(value);

	function children(node) {
	    return Object.keys(node.slots || {}).sort().flatMap(field => {
	        const value = node.slots[field];
	        return (Array.isArray(value) ? value : [value]).filter(isNode$1).map(child => ({field, child}));
	    });
	}

	function index(root) {
	    const entries = [];
	    let serial = 0;
	    const visit = (node, scope = null, role = 'other', predicateRole = role, parent = null, parentField = null) => {
	        if (!isNode$1(node)) return;
	        if (kind$1(node, 'Select')) {
	            scope = {id: serial++, parent: scope, sources: []};
	            scope.sources = (node.slots.from || []).map((source, i) => ({
	                name: fold$1(source?.attrs?.as ?? source?.attrs?.table),
	                identity: ['source', scope.id, i, fold$1(source?.attrs?.db ?? null), fold$1(source?.attrs?.table ?? null)]
	            }));
	            role = 'other'; predicateRole = role;
	        }
	        const entry = {node, scope, role, predicateRole, parent, parentField, children: []};
	        entries.push(entry);
	        for (const {field, child} of children(node)) {
	            let childRole = role, childPredicateRole = predicateRole;
	            if (kind$1(node, 'Select')) {
	                childRole = ({columns: 'projection', where: 'predicate', from: 'source',
	                    groupby: 'group', having: 'having', orderby: 'order'})[field] || 'other';
	                childPredicateRole = childRole;
	            }
	            if (kind$1(node, 'TableSource') && field === 'on' && scope) {
	                childRole = 'predicate';
	                childPredicateRole = outerJoin(node.attrs.join) ? 'outer-on:' + node.attrs.join : 'predicate';
	            }
	            entry.children.push(visit(child, scope, childRole, childPredicateRole, node, field));
	        }
	        return entry;
	    };
	    const tree = visit(root);
	    return {entries, tree};
	}

	/** One newly introduced role/symbol fact at most per annotated leaf/attr edit. */
	function symbolFacts(root) {
	    const facts = new Set();
	    for (const {node, scope, role} of index(root).entries) {
	        let field;
	        // Free integer-expression rewrites introduce/remove literal spellings.
	        // Forget integer leaves here; the binary, normalized expression bound
	        // below still distinguishes their values without counting operands.
	        if (literalKinds$1.has(node.kind) && node.kind !== 'NullLiteral'
	            && !(node.kind==='NumberLiteral'&&node.attrs.storageClass==='integer')) field = 'value';
	        else if (kind$1(node, 'ColumnReference')) field = 'column';
	        else if (kind$1(node, 'TableSource')) field = 'table';
	        else if (kind$1(node, 'AggregateExpression')) field = 'name';
	        if (field && node.attrs[field] != null) facts.add(stableKey([scope ? role : 'other', node.kind, field, node.attrs[field]]));
	    }
	    return facts;
	}

	function containsCollationOrCast(node) {
	    if (!isNode$1(node)) return false;
	    if (/collat|cast/i.test(node.kind) || Object.entries(node.attrs).some(([key, value]) => /collat/i.test(key) && value != null)) return true;
	    return children(node).some(({child}) => containsCollationOrCast(child));
	}

	function binding(column, scope) {
	    const qualifier = fold$1(column.attrs.table);
	    if (qualifier == null) return ['unqualified', scope?.id ?? null];
	    for (let current = scope; current; current = current.parent) {
	        const matches = current.sources.filter(source => source.name === qualifier);
	        if (matches.length === 1) return matches[0].identity;
	        if (matches.length > 1) return ['ambiguous', current.id, qualifier];
	    }
	    return ['unbound', qualifier];
	}
	const attrsOf = node => Object.fromEntries(Object.entries(node.attrs).filter(([key, value]) => value != null && !(key === 'distinct' && value === false)));

	/**
	 * Clause/expression signatures are a deliberately coarser abstraction than the
	 * concrete AST graph. Only signatures are flattened; every search state and
	 * replayable edge remains concrete. Queries inside expressions are omitted,
	 * because JOIN relocation inside them would require a separate whole-query
	 * abstraction. Numeric storage class, CAST and collations remain represented.
	 */
	function predicateFacts(root) {
	    const facts = new Set(), indexed = index(root);
	    // Scope belongs to an AST occurrence, not a JS object identity. Cached edit
	    // constructors and reverse-idempotence can share object instances between
	    // positions. A WeakMap keyed only by nodes would make a zero-cost clone or
	    // alias edge change this abstraction even for the same logical AST.
	    const term = (node, scope) => {
	        if (!isNode$1(node)) return null;
	        if (['Select', 'CompoundSelect', 'Script', 'Subquery'].includes(node.kind)) return null;
	        const int=exactInteger(node);
	        if(int!==null)return ['NumberLiteral',{value:String(int),storageClass:'integer'},{}];
	        const decoded=decodedBooleanCase(node,child=>stableKey(term(child,scope)));
	        if(decoded&&pureExpression(decoded))return term(decoded,scope);
	        const count=canonicalCount(node);
	        if(count&&node.slots.args.slots.expr?.kind!=='Asterisk')return term(count,scope);
	        if(kind$1(node,'UnaryExpression')&&node.attrs.operator==='NOT'&&pureExpression(node.slots.expr)){
	            const child=node.slots.expr;
	            if(kind$1(child,'BinaryExpression')&&comparisonComplements[child.attrs.operator])
	                return term({...child,attrs:{...child.attrs,operator:comparisonComplements[child.attrs.operator]}},scope);
	            if(kind$1(child,'UnaryExpression')&&child.attrs.operator==='NOT'&&boolExpression(child.slots.expr))return term(child.slots.expr,scope);
	            if(kind$1(child,'BinaryExpression')&&['AND','OR'].includes(child.attrs.operator)
	                &&boolExpression(child.slots.left)&&boolExpression(child.slots.right))
	                return term(binaryExpression(child.attrs.operator==='AND'?'OR':'AND',notExpression(child.slots.left),notExpression(child.slots.right)),scope);
	        }
	        const attrs = attrsOf(node);
	        if (kind$1(node, 'ColumnReference')) {
	            delete attrs.table;
	            const slots = slotTerms(node, scope);
	            return slots === null ? null : ['ColumnReference', attrs, binding(node, scope), slots];
	        }
	        const expression = node;
	        let operator = attrs.operator;
	        if (kind$1(expression, 'BinaryExpression')) {
	            const expressionAttrs = attrsOf(expression);
	            if (pureExpression(expression) && ['!=', '<>'].includes(operator)) operator = '!=';
	            expressionAttrs.operator = operator;
	            if (['AND', 'OR'].includes(operator) && pureExpression(expression)) {
	                const parts = [];
	                const append = signature => {
	                    // A nested opposite connective may collapse by idempotence
	                    // to this connective, e.g. AND(OR(P,P),P). Flatten after
	                    // recursive canonicalization as well as before it.
	                    if (signature?.[0] === 'Boolean' && signature[1] === operator) signature[2].forEach(append);
	                    else parts.push(signature);
	                };
	                const flatten = child => {
	                    if (kind$1(child, 'BinaryExpression') && child.attrs.operator === operator && pureExpression(child)) {
	                        flatten(child.slots.left); flatten(child.slots.right);
	                    } else append(term(child, scope));
	                };
	                flatten(expression.slots.left); flatten(expression.slots.right);
	                if (parts.some(part => part === null)) return null;
	                const distinct = [...new Map(parts.map(part => [stableKey(part), part])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => part);
	                return distinct.length === 1 ? distinct[0] : ['Boolean', operator, distinct];
	            }
	            let left = term(expression.slots.left, scope), right = term(expression.slots.right, scope);
	            if (left === null || right === null) return null;
	            if (Object.hasOwn(mirrors, operator) && !containsCollationOrCast(expression)
	                && literalKinds$1.has(left[0]) && left[0] !== 'DoubleQuotedLiteral' && right[0] === 'ColumnReference') {
	                [left, right] = [right, left]; expressionAttrs.operator = mirrors[operator];
	            }
	            const rest = slotTerms(expression, scope, new Set(['left', 'right']));
	            return rest === null ? null : ['BinaryExpression', expressionAttrs, left, right, rest];
	        }
	        const slots = slotTerms(node, scope);
	        if (kind$1(node, 'UnaryExpression') && operator === 'NOT' && pureExpression(node.slots.expr)
	            && slots?.expr?.[0] === 'BinaryExpression' && slots.expr[1].operator === '=') {
	            return [slots.expr[0], {...slots.expr[1], operator: '!='}, ...slots.expr.slice(2)];
	        }
	        return slots === null ? null : [node.kind, attrs, slots];
	    };
	    const slotTerms = (node, scope, skip = new Set()) => {
	        const result = {};
	        for (const field of Object.keys(node.slots).sort()) {
	            if (skip.has(field)) continue;
	            const value = node.slots[field];
	            if (value == null || Array.isArray(value) && !value.length) continue;
	            if (Array.isArray(value)) {
	                const converted = value.map(child => child === null ? ['hole'] : term(child, scope));
	                if (converted.some(child => child === null)) return null;
	                result[field] = converted;
	            } else {
	                result[field] = term(value, scope);
	                if (result[field] === null) return null;
	            }
	        }
	        return result;
	    };
	    const conjunction = (operator, signatures) => {
	        const parts = [];
	        const append = signature => {
	            if (signature?.[0] === 'Boolean' && signature[1] === operator) signature[2].forEach(append);
	            else parts.push(signature);
	        };
	        signatures.forEach(append);
	        const distinct = [...new Map(parts.map(part => [stableKey(part), part])).entries()]
	            .sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => part);
	        return distinct.length === 1 ? distinct[0] : ['Boolean', operator, distinct];
	    };
	    // This additional abstraction deliberately forgets Boolean evaluation order.
	    // The separate ordered-call fact retains volatile-call ordering. Flattening
	    // here permits JOIN/WHERE conjunctions to share a signature while preserving
	    // AND-versus-OR precedence. It does not transform any concrete graph state.
	    const booleanForm = signature => {
	        if (signature === null || typeof signature !== 'object') return signature;
	        if (!Array.isArray(signature)) return Object.fromEntries(Object.entries(signature).map(([key, value]) => [key, booleanForm(value)]));
	        const normalized = signature.map(booleanForm);
	        if (normalized[0] === 'Boolean') return conjunction(normalized[1], normalized[2]);
	        if (normalized[0] === 'BinaryExpression' && ['AND', 'OR'].includes(normalized[1]?.operator)) {
	            return conjunction(normalized[1].operator, [normalized[2], normalized[3]]);
	        }
	        if (normalized[0] === 'UnaryExpression' && normalized[1]?.operator === 'NOT'
	            && normalized[2]?.expr?.[0] === 'BinaryExpression' && normalized[2].expr[1]?.operator === '=') {
	            return [normalized[2].expr[0], {...normalized[2].expr[1], operator: '!='}, ...normalized[2].expr.slice(2)];
	        }
	        return normalized;
	    };
	    const callSequences = new Map();
	    // Repeated predicates in distinct DML statements perform distinct work.
	    // A global set alone would miss changing one of several identical WHEREs.
	    // No semantic zero edit reorders/adds/removes top-level statements. Paid
	    // statement edits may shift many indexes; hence this still participates
	    // only in the binary missing-fact bound, never a counted bound.
	    if (root.kind === 'Script') for (let i = 0; i < (root.slots.statements || []).length; i++) {
	        const statement = root.slots.statements[i];
	        if (!['Update', 'Delete'].includes(statement?.kind) || !statement.slots.where) continue;
	        const signature = term(statement.slots.where, null);
	        if (signature !== null) facts.add(stableKey(['dml-where', i, statement.kind, booleanForm(signature)]));
	    }
	    for (const {node, scope, role, predicateRole} of indexed.entries) {
	        // SQL type parameters, defaults/constraints and assignments also carry
	        // semantic attributes. A changed VARCHAR length is not a numeric
	        // expression leaf. These component signatures are only a binary search
	        // bound and use the same zero-edge-invariant expression abstraction.
	        if (['Definition', 'DataType', 'Assignment', 'ReferenceDefinition', 'ViewName','OrderByItem','Limit'].includes(node.kind)) {
	            // The concrete graph retains both legal FK layouts. Abstract facts
	            // describe the same local columns and reference independently of
	            // whether REFERENCES occurs on the column or on the table.
	            const tableFk=node.kind==='Definition'&&node.attrs.resource==='CONSTRAINT'&&node.attrs.constraint_type==='FOREIGN KEY';
	            const component=node.kind==='Definition'&&node.attrs.resource==='COLUMN'
	                ?{...node,slots:Object.fromEntries(Object.entries(node.slots).filter(([k])=>k!=='reference_definition'))}:node;
	            const signature = tableFk?null:term(component, scope);
	            if (signature !== null) facts.add(stableKey(['sql-component', node.kind, booleanForm(signature)]));
	        }
	        if(node.kind==='Create'&&node.attrs.keyword==='TABLE')for(const d of node.slots.create_definitions||[]){
	            const ref=d.slots?.reference_definition;if(!ref)continue;
	            const columns=d.attrs.resource==='COLUMN'?[d.slots.column]:Array.isArray(d.slots.definition)?d.slots.definition:[d.slots.definition];
	            facts.add(stableKey(['foreign-key',term(node.slots.table?.[0],scope),columns.map(c=>term(c,scope)),term(ref,scope)]));
	        }
	        if (kind$1(node, 'Select')) {
	            if (node.attrs.distinct === true) facts.add(stableKey(['distinct', scope.id]));
	            for (let i = 0; i < (node.slots.from || []).length; i++) {
	                const source = node.slots.from[i];
	                if (outerJoin(source?.attrs?.join)) facts.add(stableKey(['outer-join', scope.id, i, source.attrs.join]));
	            }
	            const from = node.slots.from || [];
	            const movableInnerSources = from.every(source => kind$1(source, 'TableSource')
	                && !source.attrs.natural && (source.slots.using == null || Array.isArray(source.slots.using) && !source.slots.using.length)
	                && (!source.attrs.join || ['INNER JOIN', 'CROSS JOIN'].includes(source.attrs.join)));
	            const filters = node.slots.where ? [term(node.slots.where, scope)] : [];
	            if (movableInnerSources) for (const source of from) {
	                if (source.attrs.join === 'INNER JOIN' && pureExpression(source.slots.on)) filters.push(term(source.slots.on, scope));
	            }
	            if (filters.length && filters.every(signature => signature !== null)) {
	                facts.add(stableKey(['filter-boolean', scope.id, conjunction('AND', filters.map(booleanForm))]));
	            }
	            if (node.slots.having) {
	                const signature = term(node.slots.having, scope);
	                if (signature !== null) facts.add(stableKey(['having-boolean', scope.id, booleanForm(signature)]));
	            }
	        }
	        if (kind$1(node, 'SelectItem') && role === 'projection' && node.slots.expr) {
	            const signature = term(node.slots.expr, scope);
	            if (signature !== null) facts.add(stableKey(['projection-expression', scope?.id ?? null, signature]));
	        }
	        // None of the registered zero-cost edits reorder or duplicate function
	        // calls: their purity guards reject expressions containing such calls.
	        // Keep their order separately so adding/moving pure JOIN predicates does
	        // not change this fact. Calls containing a query child remain omitted.
	        if (['FunctionExpression', 'AggregateExpression'].includes(node.kind)) {
	            const signature = term(node, scope);
	            if (signature !== null) {
	                const key = stableKey([scope?.id ?? null, predicateRole]);
	                if (!callSequences.has(key)) callSequences.set(key, {scope: scope?.id ?? null, role: predicateRole, signatures: []});
	                callSequences.get(key).signatures.push(signature);
	            }
	        }
	    }
	    for (const sequence of callSequences.values()) facts.add(stableKey(['ordered-calls', sequence.scope, sequence.role, sequence.signatures]));
	    const expressions = new Set([...literalKinds$1, 'ColumnReference', 'BinaryExpression', 'UnaryExpression',
	        'AggregateExpression', 'FunctionExpression', 'CastExpression', 'CaseExpression', 'ExpressionList', 'Subquery']);
	    const collect = (signature, scope, role) => {
	        if (signature === null || typeof signature !== 'object') return;
	        if (Array.isArray(signature)) {
	            if (signature[0] === 'BinaryExpression' && comparisons.has(signature[1]?.operator)) facts.add(stableKey(['predicate', scope?.id ?? null, role, signature]));
	            for (const child of signature) collect(child, scope, role);
	        } else for (const child of Object.values(signature)) collect(child, scope, role);
	    };
	    const visit = entry => {
	        if (!entry) return;
	        const {node, scope, predicateRole} = entry;
	        if (expressions.has(node.kind)) {
	            const signature = term(node, scope);
	            if (signature !== null) { collect(signature, scope, predicateRole); return; }
	        }
	        for (const child of entry.children) visit(child);
	    };
	    visit(indexed.tree);
	    return facts;
	}

	/** Explicit question-relative equivalences. They are not universal SQL laws:
	 * a question can permit arbitrary distinct labels for Boolean result groups.
	 * The AST remains concrete; only the admissible fact abstraction forgets labels.
	 */
	const fold=s=>typeof s==='string'?s.replace(/[A-Z]/g,c=>c.toLowerCase()):s;
	const keyCache=new WeakMap();
	function expressionKey(expr){
	    if(!expr?.kind)return stableKey(expr);
	    if(keyCache.has(expr))return keyCache.get(expr);
	    const root={kind:'Select',attrs:{},slots:{columns:[{kind:'SelectItem',attrs:{as:'label'},slots:{expr}}],from:[]}};
	    const key=stableKey([...predicateFacts(root)].sort());keyCache.set(expr,key);return key;
	}
	function labelKey(node){
	    if(node?.kind==='StringLiteral'&&typeof node.attrs.value==='string'&&Object.keys(node.attrs).every(k=>k==='value'||node.attrs[k]==null)
	        &&Object.values(node.slots).every(v=>v==null||Array.isArray(v)&&!v.length))return 'string:'+node.attrs.value;
	    const value=exactInteger(node);return value===null?null:'integer:'+String(value);
	}
	function partitionCase(node){
	    const clean=(n,slots)=>n&&Object.values(n.attrs).every(v=>v==null)
	        &&Object.entries(n.slots).every(([k,v])=>slots.includes(k)||v==null||Array.isArray(v)&&!v.length);
	    if(node?.kind!=='CaseExpression'||node.slots.expr!=null||!clean(node,['expr','args']))return null;
	    const [yes,no,otherwise,...rest]=node.slots.args||[];
	    if(rest.length||yes?.kind!=='WhenExpression'||no?.kind!=='WhenExpression'||otherwise?.kind!=='SQL:else'
	        ||!clean(yes,['cond','result'])||!clean(no,['cond','result'])||!clean(otherwise,['result'])
	        ||otherwise.slots.result?.kind!=='NullLiteral'||!clean(otherwise.slots.result,[])||!boolExpression(yes.slots.cond)||!pureExpression(yes.slots.cond))return null;
	    const a=labelKey(yes.slots.result),b=labelKey(no.slots.result);
	    if(a===null||b===null||a===b||expressionKey(no.slots.cond)!==expressionKey(notExpression(yes.slots.cond)))return null;
	    return {predicate:yes.slots.cond,yes:yes.slots.result,no:no.slots.result};
	}
	function partitionExpression(node){
	    const decoded=partitionCase(node);
	    if(decoded)return {...decoded,build:p=>labelledCase(p,decoded.yes,decoded.no)};
	    if(boolExpression(node)&&pureExpression(node))return {predicate:node,build:p=>p,identity:true};
	    if(node?.kind!=='BinaryExpression'||!['+','-','*','||'].includes(node.attrs.operator)||node.attrs.collate)return null;
	    for(const [field,other]of [['left','right'],['right','left']]){
	        const p=node.slots[field],constant=node.slots[other];if(!boolExpression(p)||!pureExpression(p))continue;
	        if(node.attrs.operator==='||'){
	            if(constant?.kind!=='StringLiteral'||labelKey(constant)===null)continue;
	        }else {
	            const n=exactInteger(constant);if(n===null)continue;
	            const apply=x=>node.attrs.operator==='+'?x+n:node.attrs.operator==='*'?x*n:field==='left'?x-n:n-x;
	            const a=apply(0n),b=apply(1n);if(a===b||[a,b].some(v=>v < -9223372036854775808n||v>9223372036854775807n))continue;
	        }
	        return {predicate:p,build:value=>({...node,slots:{...node.slots,[field]:value}})};
	    }
	    return null;
	}
	function labelledCase(predicate,yes,no){
	    const result=encodedBooleanCase(predicate);
	    result.slots.args[0].slots.result=yes;result.slots.args[1].slots.result=no;return result;
	}
	function* locations$1(node,path=[]){
	    if(!node?.kind)return;yield {node,path};
	    for(const [field,v]of Object.entries(node.slots))if(Array.isArray(v)){
	        for(let i=0;i<v.length;i++)yield*locations$1(v[i],[...path,'slots',field,i]);
	    }else yield*locations$1(v,[...path,'slots',field]);
	}
	function* freeLabelEntries(root,names){
	    const allowed=new Set(names);
	    for(const {node:select,path}of locations$1(root))if(select.kind==='Select'){
	        const columns=select.slots.columns||[],groups=select.slots.groupby?.slots.columns||[];
	        for(let i=0;i<columns.length;i++){
	            const item=columns[i],name=fold(item.attrs.as);
	            if(!allowed.has(name)||columns.filter(c=>fold(c.attrs.as)===name).length!==1
	                ||!groups.some(c=>c.kind==='ColumnReference'&&c.attrs.table==null&&fold(c.attrs.column)===name))continue;
	            // A classifier used to filter or order rows is not merely a label.
	            if(['where','having','orderby','from'].some(field=>{
	                const v=select.slots[field];return (Array.isArray(v)?v:[v]).some(n=>[...locations$1(n)].some(({node:c})=>c.kind==='ColumnReference'&&c.attrs.table==null&&fold(c.attrs.column)===name));
	            }))continue;
	            yield {item,select,path:[...path,'slots','columns',i,'slots','expr']};
	        }
	    }
	}
	function* freeDiagnosticEntries(root,names){
	    for(const {node,path}of locations$1(root))if(node.kind==='CompoundSelect'&&node.attrs.operator==='UNION'
	        &&!node.slots.limit&&!(node.slots.orderby||[]).length&&[...freeLabelEntries(node.slots.left,names)].length){
	        const row=node.slots.right;if(row?.kind!=='Select'||(row.slots.from||[]).length||row.attrs.distinct
	            ||Object.entries(row.slots).some(([k,v])=>k!=='columns'&&v!=null&&(!Array.isArray(v)||v.length)))continue;
	        const columns=row.slots.columns||[];
	        const constant=n=>n?.kind==='NullLiteral'||labelKey(n)!==null;
	        if(!columns.length||columns.some(c=>c.attrs.as!=null||!constant(c.slots.expr)))continue;
	        yield {select:row,path:[...path,'slots','right','slots','columns'],columns};
	    }
	}
	function abstractGroupLabels(root,names,freeDiagnostics=false){
	    if(!names?.length)return root;
	    const substitutions=new Map();for(const {item,path}of freeLabelEntries(root,names)){
	        const decoded=partitionExpression(item.slots.expr);if(decoded){
	            const p=decoded.predicate,inverse=notExpression(p);
	            substitutions.set(JSON.stringify(path),expressionKey(p)<=expressionKey(inverse)?p:inverse);
	        }
	    }
	    if(freeDiagnostics)for(const {columns,path}of freeDiagnosticEntries(root,names))for(let i=0;i<columns.length;i++)
	        substitutions.set(JSON.stringify([...path,i,'slots','expr']),{kind:'NumberLiteral',attrs:{value:'0',storageClass:'integer'},slots:{}});
	    if(!substitutions.size)return root;
	    const visit=(node,path=[])=>{
	        if(!node?.kind)return node;
	        const replacement=substitutions.get(JSON.stringify(path));if(replacement)return replacement;
	        return {...node,slots:Object.fromEntries(Object.entries(node.slots).map(([field,v])=>[field,Array.isArray(v)?v.map((c,i)=>visit(c,[...path,'slots',field,i])):visit(v,[...path,'slots',field])]))};
	    };return visit(root);
	}

	/**
	 * SQL-specific neighbour functions for the implicit AST graph in Graph-based QSS.
	 *
	 * An edit has a fixed price and applies at EVERY compatible AST position. Target
	 * metadata defines finite constructor/value domains, never a positional repair
	 * plan. Incomplete and non-executable states deliberately remain in the graph.
	 */

	const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
	const isNode = value => Boolean(value && typeof value.kind === 'string' && value.attrs && value.slots);
	const stable = stableKey;
	const equal = (a, b) => stable(a) === stable(b);
	const upper = name => name ? name[0].toUpperCase() + name.slice(1) : '';
	const kind = (node, name) => node?.kind === name;
	const binary = (operator, left = null, right = null) => ({kind: 'BinaryExpression', attrs: {operator}, slots: {left, right}});
	const unary = (operator, expr = null) => ({kind: 'UnaryExpression', attrs: {operator}, slots: {expr}});

	function* locations(root, path = [], parent = null, slot = null) {
	    if (!isNode(root)) return;
	    yield {node: root, path, parent, slot};
	    for (const [name, value] of Object.entries(root.slots)) {
	        if (Array.isArray(value)) {
	            for (let i = 0; i < value.length; ++i) yield* locations(value[i], [...path, 'slots', name, i], root, name);
	        } else yield* locations(value, [...path, 'slots', name], root, name);
	    }
	}
	function get(root, path) { return path.reduce((value, key) => value?.[key], root); }
	function replace(root, path, value) {
	    if (!path.length) return value;
	    const [key, ...rest] = path;
	    const copy = Array.isArray(root) ? root.slice() : {...root};
	    copy[key] = replace(root?.[key], rest, value);
	    return copy;
	}
	function stats(root) {
	    let nodes = 0, depth = 0, listLength = 0;
	    for (const item of locations(root)) {
	        ++nodes; depth = Math.max(depth, item.path.length / 2 + 1);
	        for (const value of Object.values(item.node.slots)) if (Array.isArray(value)) listLength = Math.max(listLength, value.length);
	    }
	    return {nodes, depth, listLength};
	}
	function booleanHeight(node) {
	    if (!isNode(node)) return 0;
	    const height = Math.max(0, ...Object.values(node.slots).flatMap(value => (Array.isArray(value) ? value : [value]).map(booleanHeight)));
	    return boolean(node) ? height + 1 : height;
	}
	const literalKinds = new Set(['NumberLiteral', 'StringLiteral', 'NullLiteral', 'BooleanLiteral', 'BigIntLiteral', 'DoubleQuotedLiteral']);
	const expressionKinds = new Set(['ColumnReference', ...literalKinds, 'BinaryExpression', 'UnaryExpression', 'AggregateExpression',
	    'FunctionExpression', 'CaseExpression', 'CastExpression', 'ExpressionList', 'Subquery', 'ParameterExpression']);
	const predicates = new Set(['=', '==', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IS NOT', 'AND', 'OR', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN']);
	const literal = node => literalKinds.has(node?.kind) && node.kind !== 'DoubleQuotedLiteral';
	function bindQuotedName(node,name){
	    if(!node||['Select','Subquery','CompoundSelect'].includes(node.kind))return node;
	    if(node.kind==='DoubleQuotedLiteral'&&foldIdentifier(node.attrs.value)===name
	        &&Object.values(node.slots).every(v=>v==null||Array.isArray(v)&&!v.length))
	        return {kind:'ColumnReference',attrs:{table:null,column:name},slots:{collate:null}};
	    return {...node,slots:Object.fromEntries(Object.entries(node.slots).map(([k,v])=>[k,Array.isArray(v)?v.map(c=>bindQuotedName(c,name)):bindQuotedName(v,name)]))};
	}
	function boolean(node) {
	    return kind(node, 'BooleanLiteral') || kind(node, 'BinaryExpression') && predicates.has(node.attrs.operator)
	        || kind(node, 'UnaryExpression') && node.attrs.operator === 'NOT';
	}
	function containsCollation(node) {
	    return [...locations(node)].some(({node: item}) => /collat|cast/i.test(item.kind)
	        || Object.entries(item.attrs).some(([key, value]) => /collat/i.test(key) && value != null));
	}
	const plainOperator = (node, fields) => Object.entries(node.attrs).every(([name, value]) => name === 'operator' || value == null)
	    && Object.entries(node.slots).every(([name, value]) => fields.includes(name) || value == null || Array.isArray(value) && !value.length);

	function ancestorNodes(root, path) {
	    const result = [];
	    let value = root;
	    if (isNode(value)) result.push(value);
	    for (const part of path) {
	        value = value?.[part];
	        if (isNode(value)) result.push(value);
	    }
	    return result;
	}
	const foldIdentifier = value => typeof value === 'string' ? value.replace(/[A-Z]/g, letter => letter.toLowerCase()) : value;

	/**
	 * A column-looking expression need not be pure in SQLite: a SELECT alias can
	 * expand to a volatile function, and a derived/CTE/view column can hide one.
	 * Resolve provenance in the lexical SELECT scopes before granting a free law.
	 * The check is deliberately conservative; it never changes the AST or SQL.
	 */
	function expressionContextGuard(schema) {
	    const views = new Set((schema?.tables || []).filter(table => foldIdentifier(table.type) === 'view')
	        .map(table => foldIdentifier(table.name)));
	    const cache=new WeakMap();
	    const origins=root=>{
	        if(cache.has(root))return cache.get(root);
	        const definitions=new Map(),opaque=new Set(views);
	        for(const {node}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='VIEW'){
	            const name=foldIdentifier(node.slots.view?.attrs.view);
	            if(typeof name==='string'){if(!definitions.has(name))definitions.set(name,[]);definitions.get(name).push(node.slots.select);opaque.add(name);}
	        }
	        const safeQuery=(query,seen=new Set())=>Boolean(query)&&[...locations(query)].every(({node})=>{
	            if(node.kind==='FunctionExpression'&&!deterministicFunction(node)||(node.slots.with||[]).length)return false;
	            if(node.kind.startsWith('SQL:')&&typeof node.attrs.value==='string'&&/^CURRENT_(?:DATE|TIME|TIMESTAMP)$/i.test(node.attrs.value))return false;
	            if(node.kind==='AggregateExpression'&&!['COUNT','SUM','AVG','MIN','MAX','TOTAL'].includes(node.attrs.name))return false;
	            if(node.kind!=='TableSource'||node.slots.expr)return true;
	            const name=foldIdentifier(node.attrs.table);
	            if(views.has(name))return false;
	            if(!definitions.has(name))return typeof name==='string';
	            if(seen.has(name))return false;
	            return definitions.get(name).every(q=>safeQuery(q,new Set([...seen,name])));
	        });
	        for(const [name,queries]of definitions)if(!views.has(name)&&queries.every(q=>safeQuery(q,new Set([name]))))opaque.delete(name);
	        const sourceIsOpaque=source=>!kind(source,'TableSource')||(source.slots.expr?!safeQuery(source.slots.expr):typeof source.attrs.table!=='string'||opaque.has(foldIdentifier(source.attrs.table)));
	        const value={opaque,safeQuery,sourceIsOpaque};cache.set(root,value);return value;
	    };
	    const safeAlias=expr=>pureExpression(expr)||kind(expr,'AggregateExpression')&&['COUNT','SUM','AVG','MIN','MAX','TOTAL'].includes(expr.attrs.name)
	        &&!expr.slots.over&&!containsCollation(expr)&&(kind(expr.slots.args?.slots.expr,'Asterisk')||pureExpression(expr.slots.args?.slots.expr))
	        ||deterministicFunction(expr)&&!expr.slots.over&&!containsCollation(expr)&&expr.slots.args?.slots.value?.length>0&&expr.slots.args.slots.value.every(safeAlias)
	        ||kind(expr,'BinaryExpression')&&!containsCollation(expr)&&safeAlias(expr.slots.left)&&safeAlias(expr.slots.right)
	        ||kind(expr,'UnaryExpression')&&['NOT','+','-','~'].includes(expr.attrs.operator)&&safeAlias(expr.slots.expr);
	    const guard=(expression, root, path) => {
	        const {opaque,sourceIsOpaque}=origins(root);
	        const references = [...locations(expression)].filter(({node}) => kind(node, 'ColumnReference')).map(({node}) => node);
	        if (!references.length) return true;
	        const ancestors = ancestorNodes(root, path), scopes = ancestors.filter(node => kind(node, 'Select'));
	        if (ancestors.some(node => (node.slots.with || []).length > 0)) return false;
	        if (!scopes.length) {
	            // CHECK and other base-column expressions do not acquire a SELECT
	            // alias context. Still reject a command involving a known view.
	            const command = ancestors.find(node => node.kind !== 'Script') || expression;
	            return ![...locations(command)].some(({node}) => kind(node, 'TableSource')
	                && opaque.has(foldIdentifier(node.attrs.table)))
	                && !references.some(node => node.attrs.table != null && opaque.has(foldIdentifier(node.attrs.table)));
	        }
	        for (const reference of references) {
	            const qualifier = reference.attrs.table;
	            if (qualifier == null) {
	                // SQLite can expand SELECT aliases in WHERE and ON, including
	                // correlated scopes. Only a matching alias matters: an unrelated
	                // function in the SELECT list does not make base columns impure.
	                for (const scope of scopes) {
	                    if ((scope.slots.columns || []).some(item => item?.attrs?.as != null
	                        && foldIdentifier(item.attrs.as) === foldIdentifier(reference.attrs.column)
	                        && !safeAlias(item.slots.expr))) return false;
	                    if ((scope.slots.from || []).some(sourceIsOpaque)) return false;
	                }
	            } else {
	                let resolved = false;
	                for (let i = scopes.length - 1; i >= 0; --i) {
	                    const sources = (scopes[i].slots.from || []).filter(source =>
	                        foldIdentifier(source?.attrs?.as ?? source?.attrs?.table) === foldIdentifier(qualifier));
	                    if (!sources.length) continue;
	                    if (sources.length !== 1 || sourceIsOpaque(sources[0])) return false;
	                    resolved = true;
	                    break;
	                }
	                if (!resolved) return false;
	            }
	        }
	        return true;
	    };
	    guard.querySafe=(query,root)=>origins(root).safeQuery(query);
	    return guard;
	}

	/** Exported for focused graph/trace verification, not a distance approximation. */
	function replayOperation(root, operation) {
	    const before = get(root, operation.path);
	    if (!equal(before, operation.before)) throw new Error('Edit replay does not match its starting AST.');
	    return replace(root, operation.path, operation.after);
	}

	function createEditGraph(reference, answer, schema = {}, costOverrides = {}, requirements = {}) {
	    if (!isNode(reference) || !isNode(answer)) throw new TypeError('Graph-QSS requires semantic AST nodes.');
	    const startStats = stats(answer), targetStats = stats(reference);
	    const contextSafe = expressionContextGuard(schema);
	    const constrained=Boolean(requirements.forbidden?.length||requirements.required?.length);
	    // Structural model bounds (§4.6.2), not an execution-time or visited-node budget.
	    // Leave room for reverse equivalences and temporary incomplete constructors.
	    const limits = {
	        maxNodes: Math.max(12, startStats.nodes + targetStats.nodes + 4),
	        maxDepth: Math.max(8, Math.max(startStats.depth, targetStats.depth) + 2),
	        maxListLength: Math.max(4, Math.max(startStats.listLength, targetStats.listLength) + 1),
	        maxBooleanHeight: Math.max(booleanHeight(answer), booleanHeight(reference)) + 1
	    };
	    const bounded = root => {
	        const size = stats(root);
	        return size.nodes <= limits.maxNodes && size.depth <= limits.maxDepth && size.listLength <= limits.maxListLength
	            && booleanHeight(root) <= limits.maxBooleanHeight;
	    };
	    const attrs = new Map(), grammar = new Map(), shapes = new Map(), shapeVariants = new Map(), variants = new Map(), aliases = new Set();
	    const attrDomain = (name, field) => {
	        const key = name + '.' + field;
	        if (!attrs.has(key)) attrs.set(key, {kind: name, field, values: new Map()});
	        return attrs.get(key);
	    };
	    const addValue = (name, field, value) => attrDomain(name, field).values.set(stable(value), value);
	    const addGrammar = (name, field, array, childKinds = []) => {
	        const key = name + '.' + field;
	        if (!grammar.has(key)) grammar.set(key, {kind: name, field, array, children: new Set()});
	        const rule = grammar.get(key);
	        for (const child of childKinds) rule.children.add(child);
	        if (!shapes.has(name)) shapes.set(name, {});
	        shapes.get(name)[field] = array;
	        return rule;
	    };
	    for (const root of [reference, answer]) for (const {node} of locations(root)) {
	        if (!shapes.has(node.kind)) shapes.set(node.kind, {});
	        if (!shapeVariants.has(node.kind)) shapeVariants.set(node.kind, new Map());
	        const nodeShape = Object.fromEntries(Object.entries(node.slots).map(([field, value]) => [field, Array.isArray(value)]));
	        shapeVariants.get(node.kind).set(stable(nodeShape), nodeShape);
	        if (!variants.has(node.kind)) variants.set(node.kind, new Map());
	        variants.get(node.kind).set(stable(node.attrs), node.attrs);
	        for (const [field, value] of Object.entries(node.attrs)) {
	            addValue(node.kind, field, value);
	            if ((field === 'as' || field === 'table') && typeof value === 'string') aliases.add(value);
	        }
	        for (const [field, value] of Object.entries(node.slots)) {
	            addGrammar(node.kind, field, Array.isArray(value), (Array.isArray(value) ? value : [value]).filter(isNode).map(child => child.kind));
	        }
	    }
	    // SQL constructors/slots, independent of where the target happens to use them.
	    const sqlExpressions = [...expressionKinds].filter(name => shapes.has(name)
	        || ['ColumnReference', 'NumberLiteral', 'BinaryExpression', 'UnaryExpression', 'AggregateExpression'].includes(name));
	    addGrammar('Script', 'statements', true, [...shapes.keys()].filter(name => /^(Select|Insert|Update|Delete|Create|Alter|Drop|Pragma|With|Transaction|Statement)$/.test(name)));
	    addGrammar('Select', 'columns', true, ['SelectItem']);
	    addGrammar('Select', 'from', true, ['TableSource']);
	    addGrammar('Select', 'where', false, sqlExpressions);
	    addGrammar('Select', 'having', false, sqlExpressions);
	    addGrammar('SelectItem', 'expr', false, sqlExpressions);
	    addGrammar('OrderByItem', 'expr', false, sqlExpressions);
	    addGrammar('TableSource', 'on', false, sqlExpressions);
	    addGrammar('BinaryExpression', 'left', false, sqlExpressions);
	    addGrammar('BinaryExpression', 'right', false, sqlExpressions);
	    addGrammar('UnaryExpression', 'expr', false, sqlExpressions);
	    addGrammar('AggregateExpression', 'args', false, ['AggregateArguments']);
	    addGrammar('AggregateArguments', 'expr', false, sqlExpressions);
	    // Every SQL expression position supports the finite family, not only its
	    // initial child type. This permits intermediate expression constructors.
	    const expressionRole = rule => ['expr', 'left', 'right', 'where', 'having', 'on', 'condition', 'then', 'else', 'elseValue'].includes(rule.field)
	        || rule.kind === 'GroupBy' && rule.field === 'columns';
	    for (const rule of grammar.values()) if (expressionRole(rule) && [...rule.children].some(name => expressionKinds.has(name))) {
	        for (const name of sqlExpressions) rule.children.add(name);
	    }
	    addValue('UnaryExpression', 'operator', 'NOT');
	    // The paid outer-JOIN relocation uses SQL's literal true condition 1=1.
	    addValue('NumberLiteral', 'value', '1');
	    addValue('NumberLiteral', 'storageClass', 'integer');
	    for (const operator of ['AND', 'OR', '=', '!=', '<>', '<', '>', '<=', '>=']) addValue('BinaryExpression', 'operator', operator);
	    for (const table of schema?.tables || []) {
	        if (typeof table.name !== 'string') continue;
	        addValue('TableSource', 'table', table.name);
	        addValue('ColumnReference', 'table', table.name);
	        aliases.add(table.name);
	        for (const column of table.columns || []) if (typeof column.name === 'string') addValue('ColumnReference', 'column', column.name);
	    }
	    for (const name of aliases) addValue('ColumnReference', 'table', name);
	    aliases.add('__qss_alias');
	    const defaults = {
	        Select: {distinct: false}, AggregateArguments: {distinct: false},
	        ColumnReference: {column: null, table: null, db: null},
	        TableSource: {table: null, as: null, db: null, join: null}
	    };
	    const shallow = (name, shape = shapes.get(name) || {}) => ({kind: name, attrs: {...(defaults[name] || {})}, slots: Object.fromEntries(Object.entries(shape).map(([field, array]) => [field, array ? [] : null]))});
	    const constructors = name => {
	        // Optional grammar fields may be absent rather than null in native
	        // parser extensions. Retain every observed *shallow* shape so arbitrary
	        // source/target states remain connected via the empty AST.
	        const bases = [shallow(name), ...[...(shapeVariants.get(name)?.values() || [])].map(shape => shallow(name, shape))];
	        const values = [];
	        for (const empty of bases) {
	            values.push(empty);
	            const seed = (field, value) => values.push({...empty, attrs: {...empty.attrs, [field]: value}});
	            if (literalKinds.has(name) || name === 'ColumnReference' || name === 'TableSource') {
	                // Intrinsic leaf constructors match the original addLiteral / addColumnReference.
	                for (const intrinsic of variants.get(name)?.values() || []) values.push({...empty, attrs: {...intrinsic}});
	                if (name === 'NumberLiteral') values.push({...empty, attrs: {value: '1', storageClass: 'integer'}});
	                if (name === 'ColumnReference') for (const column of attrs.get(name + '.column')?.values.values() || []) {
	                    for (const table of attrs.get(name + '.table')?.values.values() || [null]) values.push({...empty, attrs: {column, table, db: null}});
	                }
	            } else if (name === 'BinaryExpression' || name === 'UnaryExpression') {
	                for (const value of attrs.get(name + '.operator')?.values.values() || []) seed('operator', value);
	            } else if (name === 'AggregateExpression') {
	                for (const value of attrs.get(name + '.name')?.values.values() || []) {
	                    values.push({...empty, attrs: {...empty.attrs, name: value}, slots: {...empty.slots, args: shallow('AggregateArguments')}});
	                }
	            }
	        }
	        return [...new Map(values.map(value => [stable(value), value])).values()];
	    };
	    const edits = [], names = new Set();
	    const register = (name, description, defaultCost, generate,
	        {maxNewSymbols = 1, maxNewDistinct = 0, statementOperation = null, statementKind = null,
	            introducedComponent = null, preservesSymbolSet = false, maxNewRelations = 0, maxNewSources = 0,componentWorkBounded=true} = {}) => {
	        if (names.has(name)) return;
	        names.add(name);
	        const cost = own(costOverrides || {}, name) ? costOverrides[name] : defaultCost;
	        if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Edit costs must be nonnegative safe integers: ' + name);
	        // Predicate guidance is a binary missing-fact bound, not a count:
	        // one paid binding/attribute edit may introduce many contextual facts.
	        // Only the proved semantic equivalences preserve the complete fact set.
	        const maxNewPredicates = defaultCost === 0 ? 0 : 1;
	        edits.push({name, description, cost, maxNewSymbols, maxNewPredicates, maxNewDistinct,
	            statementOperation, statementKind, introducedComponent, preservesSymbolSet, maxNewRelations, maxNewSources,componentWorkBounded,
	            *apply(root) {
	                const emitted = new Set();
	                for (const change of generate(root)) {
	                    const next = replace(root, change.path, change.after);
	                    if (equal(root, next) || !bounded(next)) continue;
	                    if(cost===0&&constrained&&requirementState(root,requirements)!==requirementState(next,requirements))continue;
	                    const key = stable(next);
	                    if (emitted.has(key)) continue;
	                    emitted.add(key);
	                    yield {root: next, operation: {type: 'sql-edit', name, cost, path: change.path, before: get(root, change.path), after: change.after}};
	                }
	            }});
	    };
	    for (const rule of grammar.values()) for (const childKind of rule.children) {
	        const suffix = rule.kind + upper(rule.field) + childKind;
	        const templates = constructors(childKind);
	        const price = rule.kind === 'Script' && rule.field === 'statements' || childKind==='TableSource' ? 5 : /Distinct/i.test(childKind) ? 2 : 1;
	        register('add' + suffix, 'Add a ' + childKind + ' in SQL ' + rule.kind + '.' + rule.field, price, function* (root) {
	            for (const {node, path} of locations(root)) if (node.kind === rule.kind) {
	                const current = node.slots[rule.field], at = [...path, 'slots', rule.field];
	                if (rule.array) {
	                    if (current != null && !Array.isArray(current)) continue;
	                    const list = current || [];
	                    for (let i = 0; i <= list.length; ++i) for (const template of templates) yield {path: at, after: [...list.slice(0, i), template, ...list.slice(i)]};
	                } else if (current == null) for (const template of templates) yield {path: at, after: template};
	            }
	        }, {maxNewSymbols: literalKinds.has(childKind) || ['ColumnReference', 'TableSource', 'AggregateExpression'].includes(childKind) ? 1 : 0,
	            statementOperation: rule.kind === 'Script' && rule.field === 'statements' ? 'add' : null, statementKind: childKind,
	            introducedComponent: childKind, maxNewRelations: childKind==='TableSource'?1:0, maxNewSources:childKind==='TableSource'?1:0});
	        register('remove' + suffix, 'Remove a ' + childKind + ' from SQL ' + rule.kind + '.' + rule.field, price, function* (root) {
	            for (const {node, path} of locations(root)) if (node.kind === rule.kind) {
	                const current = node.slots[rule.field], at = [...path, 'slots', rule.field];
	                if (Array.isArray(current)) {
	                    for (let i = 0; i < current.length; ++i) if (kind(current[i], childKind)) yield {path: at, after: [...current.slice(0, i), ...current.slice(i + 1)]};
	                } else if (kind(current, childKind)) yield {path: at, after: null};
	            }
	        }, {maxNewSymbols: 0, statementOperation: rule.kind === 'Script' && rule.field === 'statements' ? 'remove' : null, statementKind: childKind});
	    }
	    for (const {kind: nodeKind, field, values} of attrs.values()) {
	        const suffix = nodeKind + upper(field), price = nodeKind==='TableSource'&&field==='table'?5:/distinct/i.test(field)?2:1;
	        for (const action of ['set', 'change', 'unset']) register(action + suffix, action + ' SQL ' + nodeKind + '.' + field, price, function* (root) {
	            for (const {node, path} of locations(root)) if (node.kind === nodeKind) {
	                const present = own(node.attrs, field), current = node.attrs[field];
	                if (action === 'unset') {
	                    if (present) {
	                        const after = {...node.attrs}; delete after[field];
	                        yield {path: [...path, 'attrs'], after};
	                    }
	                } else if (action === 'set' ? !present || current == null : present && current != null) {
	                    for (const value of values.values()) if (!present || !equal(value, current)) yield {path: [...path, 'attrs'], after: {...node.attrs, [field]: value}};
	                }
	            }
	        }, {maxNewSymbols: nodeKind==='NumberLiteral'&&field==='storageClass'?1:action !== 'unset' && (literalKinds.has(nodeKind) && field === 'value'
	            || nodeKind === 'ColumnReference' && field === 'column'
	            || nodeKind === 'TableSource' && field === 'table'
	            || nodeKind === 'AggregateExpression' && field === 'name') ? 1 : 0,
	            maxNewDistinct: nodeKind === 'Select' && field === 'distinct' && action !== 'unset' ? 1 : 0,
	            maxNewRelations:nodeKind==='TableSource'&&field==='table'&&action!=='unset'?1:0});
	    }

	    const expressionChange = (name, description, cost, transform, annotations) => register(name, description, cost, function* (root) {
	        for (const {node, path, parent, slot} of locations(root)) {
	            let contextAllowed = null;
	            for (const after of transform(node, root, path) || []) {
	                // Most AST positions cannot use this edit. Defer the scope walk
	                // until a free candidate actually exists; never weaken its guard.
	                if (cost === 0 && contextAllowed === null) contextAllowed = contextSafe(node, root, path);
	                if (contextAllowed === false) break;
	                if (parent && !grammar.get(parent.kind + '.' + slot)?.children.has(after.kind)) continue;
	                yield {path, after};
	            }
	        }
	    }, annotations);
	    const zero = {maxNewSymbols: 0, preservesSymbolSet: true};
	    const freeLabels=requirements.freeLabels||[];
	    if(freeLabels.length){
	        const labels=new Map();
	        for(const input of [reference,answer])for(const {item}of freeLabelEntries(input,freeLabels)){
	            const decoded=partitionExpression(item.slots.expr);if(decoded&&!decoded.identity)labels.set(stable(item.slots.expr),decoded);
	        }
	        register('relabelUnconstrainedBooleanGroups','Choose distinct Boolean-group labels explicitly left free by the question',0,function*(root){
	            for(const {item,path}of freeLabelEntries(root,freeLabels)){
	                const expr=item.slots.expr;if(!contextSafe(expr,root,path))continue;
	                const decoded=partitionExpression(expr);
	                if(decoded&&!decoded.identity)yield {path,after:decoded.predicate};
	                else if(boolExpression(expr)&&pureExpression(expr)){
	                    yield {path,after:expr.kind==='UnaryExpression'&&expr.attrs.operator==='NOT'&&boolExpression(expr.slots.expr)?expr.slots.expr:notExpression(expr)};
	                    for(const label of labels.values())yield {path,after:label.build(expr)};
	                }
	            }
	        },zero);
	        if(requirements.freeDiagnostics){
	            const tuples=new Map();for(const input of [reference,answer])for(const {columns}of freeDiagnosticEntries(input,freeLabels))tuples.set(stable(columns.map(c=>c.slots.expr)),columns.map(c=>c.slots.expr));
	            register('chooseUnconstrainedDiagnosticTuple','Choose the question-permitted constant feedback tuple after a verified result-row count',0,function*(root){
	                for(const {columns,path}of freeDiagnosticEntries(root,freeLabels))for(const tuple of tuples.values())if(tuple.length===columns.length)
	                    yield {path,after:columns.map((c,i)=>({...c,slots:{...c.slots,expr:tuple[i]}}))};
	            },zero);
	        }
	    }
	    register('repairDeclaredColumnBinding','Repair a column declaration and bind matching SQLite quoted CHECK names',1,function*(root){
	        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE'||node.kind==='Alter'&&Array.isArray(node.slots.expr)){
	            const field=node.kind==='Alter'?'expr':'create_definitions',defs=node.slots[field]||[];
	            for(let i=0;i<defs.length;i++)if(defs[i].attrs.resource==='COLUMN'&&defs[i].slots.column?.kind==='ColumnReference'
	                &&(node.kind!=='Alter'||defs[i].attrs.action==='ADD'))
	                for(const name of attrs.get('ColumnReference.column')?.values.values()||[]){
	                    if(typeof name!=='string'||name==='*'||name===defs[i].slots.column.attrs.column)continue;
	                    const after=defs.map((d,j)=>{
	                        const n={...d,slots:{...d.slots}};
	                        if(i===j)n.slots.column={...d.slots.column,attrs:{...d.slots.column.attrs,column:name}};
	                        if(n.slots.check)n.slots.check=bindQuotedName(n.slots.check,name);
	                        return n;
	                    });
	                    yield {path:[...path,'slots',field],after};
	                }
	        }
	    },{maxNewSymbols:1});
	    const projections=new Map();
	    for(const input of [reference,answer])for(const {node}of locations(input))
	        if(node.kind==='SelectItem'&&node.slots.expr
	            &&![...locations(node)].some(({node:n})=>['Select','CompoundSelect','Subquery','TableSource','Definition','OrderByItem'].includes(n.kind)))
	            projections.set(stable(node),node);
	    if(projections.size)register('insertProjectedExpression','Insert one non-query projected SQL expression',1,function*(root){
	        for(const {node,path}of locations(root))if(node.kind==='Select'){
	            const list=node.slots.columns||[];
	            for(const value of projections.values())for(let i=0;i<=list.length;i++){
	                const slots={...node.slots,columns:[...list.slice(0,i),value,...list.slice(i)]};
	                if(typeof value.attrs.as==='string')for(const field of ['where','having','groupby','orderby','from']){
	                    const v=slots[field],name=foldIdentifier(value.attrs.as);slots[field]=Array.isArray(v)?v.map(c=>bindQuotedName(c,name)):bindQuotedName(v,name);
	                }
	                yield {path,after:{...node,slots}};
	            }
	        }
	    },{maxNewSymbols:Math.max(0,...[...projections.values()].map(n=>symbolFacts(n).size+4)),introducedComponent:'SelectItem',
	        componentWorkBounded:![...projections.values()].some(n=>[...locations(n)].some(({node})=>node.kind==='DataType'))});
	    // Restore one declarative column constraint as one logical repair. A foreign
	    // key target is not the data source of the entire submitted SQL operation.
	    for(const field of ['reference_definition','nullable']){
	        const values=new Map();
	        for(const input of [reference,answer])for(const {node}of locations(input))
	            if((node.kind==='Definition'||node.kind==='Alter'&&node.attrs.action==='ADD')&&node.attrs.resource==='COLUMN'&&node.slots[field])values.set(stable(node.slots[field]),node.slots[field]);
	        if(!values.size)continue;
	        const bound=Math.max(0,...[...values.values()].map(n=>symbolFacts(n).size));
	        register('repairColumn'+upper(field),'Repair one SQL column constraint',1,function*(root){
	            for(const {node,path}of locations(root))if((node.kind==='Definition'||node.kind==='Alter'&&node.attrs.action==='ADD')&&node.attrs.resource==='COLUMN')
	                for(const value of values.values())yield {path:[...path,'slots',field],after:value};
	        },{maxNewSymbols:bound});
	    }
	    const tableConstraints=new Map();
	    for(const input of [reference,answer])for(const {node}of locations(input))
	        if(node.kind==='Definition'&&node.attrs.resource==='CONSTRAINT'
	            &&['FOREIGN KEY','PRIMARY KEY','UNIQUE'].includes(node.attrs.constraint_type)
	            &&![...locations(node)].some(({node:n})=>['Select','CompoundSelect','Subquery'].includes(n.kind)))tableConstraints.set(stable(node),node);
	    if(tableConstraints.size)register('restoreTableConstraint','Restore one declared table constraint',1,function*(root){
	        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE')
	            for(const value of tableConstraints.values())for(let i=0;i<=(node.slots.create_definitions||[]).length;i++)
	                yield {path:[...path,'slots','create_definitions'],after:[...(node.slots.create_definitions||[]).slice(0,i),value,...(node.slots.create_definitions||[]).slice(i)]};
	    },{maxNewSymbols:Math.max(0,...[...tableConstraints.values()].map(n=>symbolFacts(n).size)),introducedComponent:'Definition'});
	    register('relocateSingleColumnForeignKey','Move an unnamed single-column foreign key between column and table syntax',0,function*(root){
	        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE'){
	            const defs=node.slots.create_definitions||[];
	            for(let i=0;i<defs.length;i++){
	                const d=defs[i];
	                if(d.kind!=='Definition')continue;
	                if(d.attrs.resource==='COLUMN'&&d.slots.reference_definition&&!d.attrs.constraint
	                    &&!defs.slice(i+1).some(v=>v.slots.reference_definition)){
	                    const column={...d,slots:{...d.slots}};delete column.slots.reference_definition;
	                    const fk={kind:'Definition',attrs:{constraint:null,constraint_type:'FOREIGN KEY',keyword:null,index:null,resource:'CONSTRAINT'},
	                        slots:{definition:[d.slots.column],reference_definition:d.slots.reference_definition}};
	                    yield {path:[...path,'slots','create_definitions'],after:defs.map((v,j)=>j===i?column:v).concat(fk)};
	                }
	                if(d.attrs.resource!=='CONSTRAINT'||d.attrs.constraint_type!=='FOREIGN KEY'||d.attrs.constraint
	                    ||Object.entries(d.attrs).some(([k,v])=>!['resource','constraint_type','constraint','keyword','index'].includes(k)&&v!=null)
	                    ||d.slots.definition?.length!==1||!d.slots.reference_definition)continue;
	                const j=defs.findIndex(v=>v.kind==='Definition'&&v.attrs.resource==='COLUMN'&&!v.slots.reference_definition&&equal(v.slots.column,d.slots.definition[0]));
	                if(j<0||defs.slice(j+1,i).some(v=>v.slots.reference_definition))continue;
	                yield {path:[...path,'slots','create_definitions'],after:defs.map((v,k)=>k===j?{...v,slots:{...v.slots,reference_definition:d.slots.reference_definition}}:v).filter((v,k)=>k!==i)};
	            }
	        }
	    },{...zero,introducedComponent:'Definition'});
	    const constantTemplates = new Map();
	    for (const input of [reference,answer]) for (const {node} of locations(input)) {
	        const value=exactInteger(node);if(value===null)continue;
	        const key=String(value);if(!constantTemplates.has(key))constantTemplates.set(key,new Map());
	        constantTemplates.get(key).set(stable(node),node);
	    }
	    const namedProjectionContext = (root,path) => {
	        const ancestors=ancestorNodes(root,path);
	        const projection=ancestors.findLast(n=>n.kind==='SelectItem');
	        return !projection || projection.attrs.as != null;
	    };
	    expressionChange('rewriteExactIntegerConstant','Rewrite an exactly equal int64 constant expression',0,(node,root,path)=>{
	        if(!namedProjectionContext(root,path))return [];
	        const value=exactInteger(node);return value===null?[]:[...(constantTemplates.get(String(value))?.values()||[])];
	    },zero);
	    expressionChange('negateComplementaryComparison','Express a comparison by negating its complement',0,node=>{
	        if(node.kind==='BinaryExpression'&&comparisonComplements[node.attrs.operator]&&pureExpression(node)
	            &&plainOperator(node,['left','right']))return [notExpression({...node,attrs:{...node.attrs,operator:comparisonComplements[node.attrs.operator]}})];
	        if(node.kind==='UnaryExpression'&&node.attrs.operator==='NOT'&&node.slots.expr?.kind==='BinaryExpression'
	            &&comparisonComplements[node.slots.expr.attrs.operator]&&pureExpression(node.slots.expr)
	            &&plainOperator(node,['expr'])&&plainOperator(node.slots.expr,['left','right']))
	            return [{...node.slots.expr,attrs:{...node.slots.expr.attrs,operator:comparisonComplements[node.slots.expr.attrs.operator]}}];
	        return [];
	    },zero);
	    expressionChange('deMorganBoolean','Apply three-valued De Morgan laws to Boolean predicates',0,node=>{
	        if(node.kind==='BinaryExpression'&&['AND','OR'].includes(node.attrs.operator)&&pureExpression(node)
	            &&boolExpression(node.slots.left)&&boolExpression(node.slots.right)&&plainOperator(node,['left','right']))
	            return [notExpression(binaryExpression(node.attrs.operator==='AND'?'OR':'AND',notExpression(node.slots.left),notExpression(node.slots.right)))];
	        if(node.kind==='UnaryExpression'&&node.attrs.operator==='NOT'&&plainOperator(node,['expr'])){
	            const child=node.slots.expr;
	            if(child?.kind==='BinaryExpression'&&['AND','OR'].includes(child.attrs.operator)&&pureExpression(child)
	                &&plainOperator(child,['left','right'])
	                &&child.slots.left?.kind==='UnaryExpression'&&child.slots.left.attrs.operator==='NOT'
	                &&child.slots.right?.kind==='UnaryExpression'&&child.slots.right.attrs.operator==='NOT'
	                &&plainOperator(child.slots.left,['expr'])&&plainOperator(child.slots.right,['expr'])
	                &&boolExpression(child.slots.left.slots.expr)&&boolExpression(child.slots.right.slots.expr))
	                return [binaryExpression(child.attrs.operator==='AND'?'OR':'AND',child.slots.left.slots.expr,child.slots.right.slots.expr)];
	        }return [];
	    },zero);
	    expressionChange('booleanCaseEncoding','Encode a Boolean value as a NULL-preserving CASE expression',0,(node,root,path)=>{
	        const parents=ancestorNodes(root,path);
	        const projection=parents.at(-2);
	        if(projection?.kind!=='SelectItem'||projection.attrs.as==null)return [];
	        const decoded=decodedBooleanCase(node);
	        if(decoded&&pureExpression(decoded))return [decoded];
	        return boolExpression(node)&&pureExpression(node)?[encodedBooleanCase(node)]:[];
	    },zero);
	    expressionChange('countStarOne','Count rows using either star or the non-NULL integer one',0,(node,root,path)=>{
	        if(!namedProjectionContext(root,path)||!canonicalCount(node))return [];
	        const expr=node.slots.args.slots.expr?.kind==='Asterisk'
	            ?{kind:'NumberLiteral',attrs:{value:'1',storageClass:'integer'},slots:{}}
	            :{kind:'Asterisk',attrs:{value:'*'},slots:{}};
	        return [{...node,slots:{...node.slots,args:{...node.slots.args,slots:{...node.slots.args.slots,expr}}}}];
	    },zero);
	    expressionChange('changeLiteral', 'Change a SQL literal, retaining its intrinsic SQLite storage class', 1, node => {
	        if (!literalKinds.has(node.kind)) return [];
	        return [...literalKinds].flatMap(name => [...(variants.get(name)?.values() || [])].map(intrinsic => ({...shallow(name), attrs: {...intrinsic}})));
	    }, {maxNewSymbols: 1});
	    expressionChange('changeColumnReference', 'Change the column and its table qualifier together', 1, node => {
	        if (!kind(node, 'ColumnReference')) return [];
	        return constructors('ColumnReference').filter(candidate => candidate.attrs.column != null);
	    });
	    expressionChange('changeAggregateType', 'Change a SQL aggregate function while retaining its argument', 1, node => {
	        if (!kind(node, 'AggregateExpression')) return [];
	        return [...(attrs.get('AggregateExpression.name')?.values.values() || [])].map(name => ({...node, attrs: {...node.attrs, name}}));
	    }, {maxNewSymbols: 1});
	    expressionChange('commuteBooleanOperands', 'Swap pure AND/OR operands', 0, node => {
	        if (kind(node, 'BinaryExpression') && ['AND', 'OR'].includes(node.attrs.operator)
	            && pureExpression(node.slots.left) && pureExpression(node.slots.right)) return [{...node, slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
	        return [];
	    }, zero);
	    expressionChange('associateBooleanOperands', 'Reassociate pure AND/OR operands', 0, node => {
	        if (!kind(node, 'BinaryExpression') || !['AND', 'OR'].includes(node.attrs.operator) || !pureExpression(node) || !plainOperator(node, ['left', 'right'])) return [];
	        const op = node.attrs.operator, a = node.slots.left, b = node.slots.right, result = [];
	        if (kind(a, 'BinaryExpression') && a.attrs.operator === op && plainOperator(a, ['left', 'right'])) result.push(binary(op, a.slots.left, binary(op, a.slots.right, b)));
	        if (kind(b, 'BinaryExpression') && b.attrs.operator === op && plainOperator(b, ['left', 'right'])) result.push(binary(op, binary(op, a, b.slots.left), b.slots.right));
	        return result;
	    }, zero);
	    expressionChange('duplicateBooleanPredicate', 'Duplicate a pure Boolean predicate (reverse idempotence)', 0, node => {
	        if (!boolean(node) || !pureExpression(node)) return [];
	        return [binary('AND', node, node), binary('OR', node, node)];
	    }, zero);
	    expressionChange('collapseDuplicateBooleanPredicate', 'Collapse repeated pure Boolean predicate', 0, node => {
	        if (kind(node, 'BinaryExpression') && ['AND', 'OR'].includes(node.attrs.operator) && boolean(node.slots.left)
	            && plainOperator(node, ['left', 'right']) && pureExpression(node.slots.left) && equal(node.slots.left, node.slots.right)) return [node.slots.left];
	        return [];
	    }, zero);
	    expressionChange('rewriteNotEqual', 'Rewrite != or <> as negated equality, and conversely', 0, node => {
	        if (kind(node, 'BinaryExpression') && ['!=', '<>'].includes(node.attrs.operator) && pureExpression(node)) return [unary('NOT', {...node, attrs: {...node.attrs, operator: '='}})];
	        if (kind(node, 'UnaryExpression') && node.attrs.operator === 'NOT' && kind(node.slots.expr, 'BinaryExpression')
	            && plainOperator(node, ['expr']) && node.slots.expr.attrs.operator === '=' && pureExpression(node.slots.expr)) return ['!=', '<>'].map(operator => ({...node.slots.expr, attrs: {...node.slots.expr.attrs, operator}}));
	        return [];
	    }, zero);
	    expressionChange('mirrorColumnLiteralComparison', 'Mirror a plain SQLite column/literal comparison', 0, node => {
	        const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '<': '>', '>': '<', '<=': '>=', '>=': '<='};
	        if (!kind(node, 'BinaryExpression') || !own(mirrors, node.attrs.operator) || containsCollation(node)) return [];
	        const left = node.slots.left, right = node.slots.right;
	        if (!(kind(left, 'ColumnReference') && literal(right) || literal(left) && kind(right, 'ColumnReference'))) return [];
	        return [{...node, attrs: {...node.attrs, operator: mirrors[node.attrs.operator]}, slots: {...node.slots, left: right, right: left}}];
	    }, zero);
	    expressionChange('mirrorComparisonOperands', 'Reverse a SQL comparison, charging for possible collation or affinity changes', 1, node => {
	        const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '<': '>', '>': '<', '<=': '>=', '>=': '<='};
	        if (!kind(node, 'BinaryExpression') || !own(mirrors, node.attrs.operator)) return [];
	        return [{...node, attrs: {...node.attrs, operator: mirrors[node.attrs.operator]},
	            slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
	    }, {maxNewSymbols: 0});
	    expressionChange('swapBinaryOperands', 'Swap the operands of a binary SQL operation', 1, node => {
	        if (!kind(node, 'BinaryExpression') || !node.slots.left || !node.slots.right) return [];
	        return [{...node, slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
	    }, {maxNewSymbols: 0});
	    expressionChange('reassociateBinaryOperands', 'Change grouping of two binary SQL operations, charging for changed semantics', 1, node => {
	        if (!kind(node, 'BinaryExpression')) return [];
	        const left = node.slots.left, right = node.slots.right, result = [];
	        if (kind(left, 'BinaryExpression')) {
	            result.push({...left, slots: {...left.slots, left: left.slots.left,
	                right: {...node, slots: {...node.slots, left: left.slots.right, right}}}});
	        }
	        if (kind(right, 'BinaryExpression')) {
	            result.push({...right, slots: {...right.slots,
	                left: {...node, slots: {...node.slots, left, right: right.slots.left}}, right: right.slots.right}});
	        }
	        return result;
	    }, {maxNewSymbols: 0});
	    // SQL-expression shortcuts preserve the existing expression rather than
	    // inserting a complete target subtree in one step.
	    expressionChange('wrapUnaryExpression', 'Wrap an expression in a unary SQL operator', 1, node => {
	        if (!expressionKinds.has(node.kind)) return [];
	        return [...(attrs.get('UnaryExpression.operator')?.values.values() || [])].map(operator => unary(operator, node));
	    }, {maxNewSymbols: 0});
	    expressionChange('unwrapUnaryExpression', 'Remove a unary SQL operator', 1, node => kind(node, 'UnaryExpression') && node.slots.expr ? [node.slots.expr] : [], {maxNewSymbols: 0});
	    expressionChange('wrapBinaryExpression', 'Add a binary SQL expression around an existing operand', 1, node => {
	        if (!expressionKinds.has(node.kind)) return [];
	        const result = [];
	        for (const operator of attrs.get('BinaryExpression.operator')?.values.values() || []) result.push(binary(operator, node, null), binary(operator, null, node));
	        return result;
	    }, {maxNewSymbols: 0});
	    expressionChange('unwrapIncompleteBinaryExpression', 'Remove a binary operator with a missing operand', 1, node => {
	        if (!kind(node, 'BinaryExpression') || node.slots.left && node.slots.right) return [];
	        return [node.slots.left || node.slots.right].filter(Boolean);
	    }, {maxNewSymbols: 0});
	    expressionChange('removeExtraneousBinaryTerm', 'Remove an extraneous binary SQL operation and retain one operand', 1, node => {
	        if (!kind(node, 'BinaryExpression')) return [];
	        return [node.slots.left, node.slots.right].filter(Boolean);
	    }, {maxNewSymbols: 0});
	    expressionChange('wrapAggregateExpression', 'Add a SQL aggregate around an expression', 1, node => {
	        if (!expressionKinds.has(node.kind)) return [];
	        return [...(attrs.get('AggregateExpression.name')?.values.values() || [])].map(name => ({kind: 'AggregateExpression', attrs: {name},
	            slots: {args: {kind: 'AggregateArguments', attrs: {distinct: false}, slots: {expr: node}}}}));
	    }, {maxNewSymbols: 1});
	    expressionChange('unwrapAggregateExpression', 'Remove a SQL aggregate while retaining its argument', 1, node => {
	        if (kind(node, 'AggregateExpression') && isNode(node.slots.args?.slots?.expr)) return [node.slots.args.slots.expr];
	        return [];
	    }, {maxNewSymbols: 0});

	    // Alias/INNER-JOIN edges are installed below as schema/scope-aware edits.
	    registerAliasEdits(register, aliases, zero);
	    registerJoinEdits(register, zero, contextSafe);
	    registerOuterJoinEdits(register);
	    for (const key of Object.keys(costOverrides || {})) if (!names.has(key)) throw new TypeError('Unknown SQL edit: ' + key);
	    const abstractCache=new WeakMap();
	    const abstractRoot=root=>{if(!freeLabels.length)return root;if(!abstractCache.has(root))abstractCache.set(root,abstractGroupLabels(root,freeLabels,requirements.freeDiagnostics));return abstractCache.get(root);};
	    return {edits, limits, bounded, abstractRoot, constructors: [...shapes.keys()], symbolIntroducingEdgesAreUnitBounded: edits.every(e=>e.maxNewSymbols<=1)};
	}

	function registerAliasEdits(register, aliases, annotations) {
	    register('renameBoundTableAlias', 'Rename a table alias and its bound references without capture', 0, function* (root) {
	        for (const {node: select, path} of locations(root)) {
	            if (!kind(select, 'Select') || !Array.isArray(select.slots.from)) continue;
	            const from = select.slots.from;
	            for (let index = 0; index < from.length; ++index) {
	                const source = from[index];
	                if (!kind(source, 'TableSource') || source.slots.expr || typeof source.attrs.table !== 'string') continue;
	                const old = source.attrs.as ?? source.attrs.table;
	                if (from.filter(other => (other?.attrs?.as ?? other?.attrs?.table) === old).length !== 1) continue;
	                for (const name of aliases) {
	                    if (name === old || from.some((other, i) => i !== index && (other?.attrs?.as ?? other?.attrs?.table) === name)) continue;
	                    const renamed = renameBinding(select, old, name, true);
	                    if (!renamed) continue;
	                    const sources = renamed.slots.from.slice();
	                    sources[index] = {...sources[index], attrs: {...sources[index].attrs, as: name}};
	                    yield {path, after: {...renamed, slots: {...renamed.slots, from: sources}}};
	                }
	            }
	        }
	    }, annotations);
	}
	function renameBinding(node, old, name, top = false, scope = {oldVisible: true, newShadowed: false}) {
	    if (!isNode(node)) return node;
	    // Follow the binding being renamed, rather than blindly substituting text.
	    // A local OLD binding shadows it; a local NEW binding can capture rewritten
	    // OLD references, but leaves already-local NEW references unchanged.
	    if (!top && kind(node, 'Select')) {
	        const bindings = (node.slots.from || []).filter(isNode).map(source => source.attrs.as ?? source.attrs.table);
	        scope = {oldVisible: scope.oldVisible && !bindings.includes(old), newShadowed: scope.newShadowed || bindings.includes(name)};
	    }
	    let attrs = node.attrs;
	    if (kind(node, 'ColumnReference')) {
	        // Introducing NEW must not repair an unbound qualifier, or capture an
	        // outer binding with that name. This check also runs inside OLD-shadowing
	        // scopes: skipping their entire subtree would miss NEW-reference capture.
	        if (attrs.table === name && !scope.newShadowed) return null;
	        if (attrs.table === old && scope.oldVisible) {
	            if (scope.newShadowed || attrs.db != null) return null;
	            attrs = {...attrs, table: name};
	        }
	    }
	    const slots = {};
	    for (const [field, value] of Object.entries(node.slots)) {
	        if (Array.isArray(value)) {
	            const next = value.map(child => renameBinding(child, old, name, false, scope));
	            if (next.some((child, i) => value[i] != null && child == null)) return null;
	            slots[field] = next;
	        } else {
	            slots[field] = renameBinding(value, old, name, false, scope);
	            if (value != null && slots[field] == null) return null;
	        }
	    }
	    return {...node, attrs, slots};
	}

	function registerJoinEdits(register, annotations, contextSafe) {
	    register('relocateInnerJoinPredicate', 'Relocate a pure INNER JOIN predicate to/from WHERE', 0, function* (root) {
	        for (const {node: select, path} of locations(root)) {
	            if (!kind(select, 'Select') || !Array.isArray(select.slots.from) || select.slots.from.length < 2
	                || !Array.isArray(select.slots.columns) || !select.slots.columns.length) continue;
	            const from = select.slots.from;
	            // Source order is unchanged, so SELECT * retains its column order.
	            // USING/NATURAL can suppress columns and are deliberately excluded.
	            if (from.some(source => !kind(source, 'TableSource') || source.slots.expr&&!contextSafe.querySafe(source.slots.expr,root) || source.attrs.natural
	                || source.slots.using != null && (!Array.isArray(source.slots.using) || source.slots.using.length > 0)
	                || source.attrs.join && !['INNER JOIN', 'CROSS JOIN'].includes(source.attrs.join))) continue;
	            for (let index = 1; index < from.length; ++index) {
	                const source = from[index];
	                const safeWhere=!select.slots.where||pureExpression(select.slots.where)&&contextSafe(select.slots.where,root,path)||contextSafe.querySafe(select,root);
	                if(!safeWhere||source.slots.on&&!contextSafe(source.slots.on,root,path))continue;
	                if (source.attrs.join === 'INNER JOIN' && pureExpression(source.slots.on)) {
	                    const allowed = new Set(from.slice(0, index + 1).map(table => table.attrs.as ?? table.attrs.table));
	                    if ([...locations(source.slots.on)].some(({node}) => kind(node, 'ColumnReference') && node.attrs.table != null && !allowed.has(node.attrs.table))) continue;
	                    const sources = from.slice();
	                    sources[index] = {...source, attrs: {...source.attrs, join: null}, slots: {...source.slots, on: null}};
	                    const where = select.slots.where ? binary('AND', select.slots.where, source.slots.on) : source.slots.on;
	                    yield {path, after: {...select, slots: {...select.slots, from: sources, where}}};
	                } else if (!source.attrs.join && !source.slots.on && select.slots.where) {
	                    const choices = [{on: select.slots.where, where: null}];
	                    if (kind(select.slots.where, 'BinaryExpression') && select.slots.where.attrs.operator === 'AND') {
	                        choices.push({on: select.slots.where.slots.left, where: select.slots.where.slots.right},
	                            {on: select.slots.where.slots.right, where: select.slots.where.slots.left});
	                    }
	                    const allowed = new Set(from.slice(0, index + 1).map(table => table.attrs.as ?? table.attrs.table));
	                    for (const {on, where} of choices) {
	                        if (!pureExpression(on)||!contextSafe(on,root,path) || [...locations(on)].some(({node}) => kind(node, 'ColumnReference') && node.attrs.table != null && !allowed.has(node.attrs.table))) continue;
	                        const sources = from.slice();
	                        sources[index] = {...source, attrs: {...source.attrs, join: 'INNER JOIN'}, slots: {...source.slots, on}};
	                        yield {path, after: {...select, slots: {...select.slots, from: sources, where}}};
	                    }
	                }
	            }
	        }
	    }, annotations);
	}

	function registerOuterJoinEdits(register) {
	    const one = () => ({kind: 'NumberLiteral', attrs: {value: '1', storageClass: 'integer'}, slots: {}});
	    const truth = () => binary('=', one(), one());
	    const isTruth = node => kind(node, 'BinaryExpression') && ['=', '=='].includes(node.attrs.operator)
	        && [node.slots.left, node.slots.right].every(child => kind(child, 'NumberLiteral') && child.attrs.value === '1')
	        && !containsCollation(node);
	    register('relocateOuterJoinPredicate', 'Move a predicate between WHERE and an outer JOIN, charging for changed unmatched rows', 1, function* (root) {
	        for (const {node: select, path} of locations(root)) {
	            if (!kind(select, 'Select') || !Array.isArray(select.slots.from)) continue;
	            for (let index = 1; index < select.slots.from.length; ++index) {
	                const source = select.slots.from[index];
	                if (!kind(source, 'TableSource') || !['LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'].includes(source.attrs.join)) continue;
	                const emit = (on, where) => {
	                    const from = select.slots.from.slice();
	                    from[index] = {...source, slots: {...source.slots, on}};
	                    return {path, after: {...select, slots: {...select.slots, from, where}}};
	                };
	                if (isTruth(source.slots.on) && pureExpression(select.slots.where)) {
	                    yield emit(select.slots.where, null);
	                    if (kind(select.slots.where, 'BinaryExpression') && select.slots.where.attrs.operator === 'AND') {
	                        yield emit(select.slots.where.slots.left, select.slots.where.slots.right);
	                        yield emit(select.slots.where.slots.right, select.slots.where.slots.left);
	                    }
	                } else if (pureExpression(source.slots.on)) {
	                    yield emit(truth(), select.slots.where ? binary('AND', select.slots.where, source.slots.on) : source.slots.on);
	                }
	            }
	        }
	    }, {maxNewSymbols: 1});
	}

	/** Exact search in an implicit, directed SQL-edit graph (paper sections 4.2–4.6). */

	let Heap$1 = class Heap {
	    values = [];
	    serial = 0;
	    push(value, priority, tie = 0, guide = 0) {
	        const entry = {value, priority, tie, guide, serial: this.serial++}, a = this.values;
	        a.push(entry); let i = a.length - 1;
	        while (i) {
	            const p = (i - 1) >> 1;
	            if (this.compare(a[p], entry) <= 0) break;
	            a[i] = a[p]; i = p;
	        }
	        a[i] = entry;
	    }
	    compare(a, b) { return a.priority - b.priority || a.tie - b.tie
	        // Finish the eligible edit families of a node before selecting its
	        // children by the scheduling guide. Otherwise an early, mildly closer
	        // free child can starve a much better neighbour from a later family.
	        || Number(b.value.type==='edit')-Number(a.value.type==='edit')
	        || a.guide-b.guide || a.serial - b.serial; }
	    pop() {
	        const a = this.values, first = a[0], last = a.pop();
	        if (a.length) {
	            let i = 0;
	            while (i * 2 + 1 < a.length) {
	                let c = i * 2 + 1;
	                if (c + 1 < a.length && this.compare(a[c + 1], a[c]) < 0) ++c;
	                if (this.compare(a[c], last) >= 0) break;
	                a[i] = a[c]; i = c;
	            }
	            a[i] = last;
	        }
	        return first;
	    }
	    get length() { return this.values.length; }
	};

	function relationWork(root) {
	    const names=new Set();let sources=0;
	    const visit=(n,inForeignKey=false)=>{if(!n?.kind)return;inForeignKey ||= n.kind==='ReferenceDefinition';if(n.kind==='TableSource'&&!inForeignKey){
	        sources++;if(typeof n.attrs.table==='string')names.add(n.attrs.table);
	    }for(const v of Object.values(n.slots))for(const c of Array.isArray(v)?v:[v])visit(c,inForeignKey);};visit(root);
	    return {names,sources};
	}

	/**
	 * The optional admissible heuristic is certified by the edit catalogue, NOT by
	 * matching only target positions. All applicable neighbours are still generated.
	 * Custom zero-price symbol-creating edits disable this heuristic automatically.
	 * An edit lacking an explicit effect bound also disables it.
	 */
	function heuristicCertificate(edits, field = 'maxNewSymbols') {
	    if (edits.some(edit => !Number.isSafeInteger(edit[field]) || edit[field] < 0)) return {enabled: false, unit: 0};
	    const introducing = edits.filter(edit => edit[field] > 0);
	    if (!introducing.length) return {enabled: false, unit: 0};
	    const unit = Math.min(...introducing.map(edit => edit.cost / edit[field]));
	    return {enabled: unit > 0, unit};
	}

	function distinctCount(root) {
	    if (!root) return 0;
	    let count = root.kind === 'Select' && root.attrs.distinct === true ? 1 : 0;
	    for (const value of Object.values(root.slots)) for (const child of Array.isArray(value) ? value : [value]) count += distinctCount(child);
	    return count;
	}
	function statements(root) {
	    const counts = new Map();
	    for (const node of root.kind === 'Script' ? root.slots.statements || [] : []) counts.set(node.kind, (counts.get(node.kind) || 0) + 1);
	    return counts;
	}
	const workComponents = new Set(['Definition', 'DataType', 'SelectItem', 'OrderByItem']);
	function componentCounts(root, counts = new Map()) {
	    if (!root) return counts;
	    if (workComponents.has(root.kind)) counts.set(root.kind, (counts.get(root.kind) || 0) + 1);
	    for (const value of Object.values(root.slots)) for (const child of Array.isArray(value) ? value : [value]) componentCounts(child, counts);
	    return counts;
	}

	// Equal lower bounds may be expanded in any order without changing distances.
	// Prefer small SQL attribute repairs before potentially enormous constructor
	// families. This fixed ordering never examines target positions or omits edits.
	function editOrder(edit) {
	    if (/^change.*(?:Value|Length|Scale|Operator)$/.test(edit.name) || edit.name === 'changeLiteral') return 0;
	    if (/^change/.test(edit.name)) return 1;
	    if (/^(?:set|unset)/.test(edit.name)) return 2;
	    if (!/^(?:add|remove)/.test(edit.name) || edit.name === 'removeExtraneousBinaryTerm') return 3;
	    return edit.name.startsWith('remove') ? 4 : 5;
	}

	/** Scheduling only, after the certified A* priority and path-cost tie.
	 * No distance claim, pruning rule or target-position restriction uses this
	 * value. Every edge remains available. It avoids breadth-first enumeration of
	 * huge free Boolean closures when several zero-cost rewrites are needed.
	 */
	function structuralSize(value){
	    if(value==null)return 0;
	    if(Array.isArray(value))return value.reduce((n,v)=>n+structuralSize(v),0);
	    if(typeof value==='object')return 1+Object.values(value).reduce((n,v)=>n+structuralSize(v),0);
	    return 1;
	}
	function structuralTieDistance(a,b,weighted=true){
	    if(a===b)return 0;
	    if(a==null||b==null)return weighted?structuralSize(a==null?b:a):1;
	    if(Array.isArray(a)||Array.isArray(b)){
	        if(!Array.isArray(a)||!Array.isArray(b))return 1;
	        let n=0;for(let i=0;i<Math.max(a.length,b.length);i++)n+=structuralTieDistance(a[i],b[i],weighted);return n;
	    }
	    if(typeof a!=='object'||typeof b!=='object')return a===b?0:1;
	    let n=0;for(const key of new Set([...Object.keys(a),...Object.keys(b)]))n+=structuralTieDistance(a[key],b[key],weighted);return n;
	}

	/** Cost partitioning for disjoint, necessary SQL work, not greedy repair.
	 * Shallow statement constructors add no symbols or DISTINCT flags; DISTINCT
	 * setters add no symbols. The per-edge charge is checked before summing these
	 * bounds. An extended catalogue with overlapping effects falls back to MAX.
	 */
	function sqlWorkBound(reference, graph, symbolUnit) {
	    const distinct = heuristicCertificate(graph.edits, 'maxNewDistinct');
	    const distinctUnit = distinct.enabled ? distinct.unit : 0;
	    const statementRates = new Map();
	    const componentRates = new Map();
	    const declaredStatements = graph.edits.every(edit => edit.statementOperation !== undefined);
	    if (declaredStatements) for (const edit of graph.edits) if (edit.statementOperation) {
	        const key = edit.statementOperation + ':' + edit.statementKind;
	        statementRates.set(key, Math.min(statementRates.get(key) ?? Infinity, edit.cost));
	    }
	    if (graph.edits.every(edit => edit.introducedComponent !== undefined&&edit.componentWorkBounded!==false)) {
	        for (const edit of graph.edits) if (workComponents.has(edit.introducedComponent)) {
	            componentRates.set(edit.introducedComponent, Math.min(componentRates.get(edit.introducedComponent) ?? Infinity, edit.cost));
	        }
	    }
	    const charge = edit => [symbolUnit * (edit.maxNewSymbols || 0), distinctUnit * (edit.maxNewDistinct || 0),
	        edit.statementOperation ? statementRates.get(edit.statementOperation + ':' + edit.statementKind) || 0 : 0,
	        componentRates.get(edit.introducedComponent) || 0];
	    const disjoint = graph.edits.every(edit => charge(edit).reduce((sum, cost) => sum + cost, 0) <= edit.cost);
	    const combine = parts => disjoint ? parts.reduce((sum, cost) => sum + cost, 0) : Math.max(0, ...parts);
	    const destinationStatements = statements(reference), destinationDistinct = distinctCount(reference), destinationComponents = componentCounts(reference);
	    return {
	        enabled: symbolUnit > 0 || distinctUnit > 0 || [...statementRates.values(), ...componentRates.values()].some(rate => rate > 0),
	        decrease: edit => combine(charge(edit)),
	        measure(root, symbolCost) {
	            const present = statements(root);
	            let statementCost = 0;
	            for (const name of new Set([...destinationStatements.keys(), ...present.keys()])) {
	                const difference = (destinationStatements.get(name) || 0) - (present.get(name) || 0);
	                statementCost += Math.abs(difference) * (statementRates.get((difference > 0 ? 'add:' : 'remove:') + name) || 0);
	            }
	            const presentComponents = componentCounts(root);
	            let componentCost = 0;
	            for (const [name, count] of destinationComponents) {
	                componentCost += Math.max(0, count - (presentComponents.get(name) || 0)) * (componentRates.get(name) || 0);
	            }
	            return combine([symbolCost, Math.max(0, destinationDistinct - distinctCount(root)) * distinctUnit, statementCost, componentCost]);
	        }
	    };
	}

	async function shortestSqlEditPath(reference, answer, graph, context, {cutoff = Infinity, useHeuristic = true} = {}) {
	    const destinationKey = stableKey(reference), startKey = stableKey(answer);
	    const certificate = heuristicCertificate(graph.edits);
	    const unit = useHeuristic && certificate.enabled ? certificate.unit : 0;
	    const predicateCertificate = heuristicCertificate(graph.edits, 'maxNewPredicates');
	    const predicateUnit = useHeuristic && predicateCertificate.enabled ? predicateCertificate.unit : 0;
	    const relationCertificate=heuristicCertificate(graph.edits,'maxNewRelations');
	    const sourceCertificate=heuristicCertificate(graph.edits,'maxNewSources');
	    const relationUnit=useHeuristic&&relationCertificate.enabled?relationCertificate.unit:0;
	    const sourceUnit=useHeuristic&&sourceCertificate.enabled?sourceCertificate.unit:0;
	    const destinationRelations=relationWork(reference);
	    const work = useHeuristic ? sqlWorkBound(reference, graph, unit) : {measure: () => 0, decrease: () => 0};
	    const abstract=root=>graph.abstractRoot?graph.abstractRoot(root):root;
	    const facts = symbolFacts(abstract(reference)), predicates = predicateFacts(abstract(reference));
	    const heuristic = root => {
	        const normalized=abstract(root),have=unit?symbolFacts(normalized):null;
	        const symbols = unit ? [...facts].filter(fact=>!have.has(fact)).length * unit : 0;
	        const present = predicateUnit ? predicateFacts(normalized) : null;
	        let missing = 0;
	        if (present) {
	            for (const fact of predicates) if (!present.has(fact)) ++missing;
	            // Free edits preserve the complete abstract fact set. An extra
	            // projection/constraint is just as much evidence of a necessary
	            // paid edit as a missing one. This remains a binary bound.
	            if(!missing)for(const fact of present)if(!predicates.has(fact)){missing=1;break;}
	        }
	        // Predicate/binding changes can affect many signatures in one paid
	        // edit. Only their presence/absence yields a certified one-edit bound.
	        const presentRelations=relationWork(root);let absentRelations=0;
	        for(const name of destinationRelations.names)if(!presentRelations.names.has(name))absentRelations++;
	        return {budget: work.measure(root, symbols), predicates: missing ? predicateUnit : 0,
	            relations:absentRelations*relationUnit,sources:Math.max(0,destinationRelations.sources-presentRelations.sources)*sourceUnit};
	    };
	    const queue = new Heap$1(), best = new Map(), expanded = new Map();
	    let settled = 0, generated = 1;
	    const startBound = heuristic(answer);
	    const initial = {root: answer, key: startKey, distance: 0, bounds: startBound,
	        h: Math.max(startBound.budget, startBound.predicates,startBound.relations,startBound.sources), previous: null, edge: null};
	    best.set(startKey, initial);
	    initial.guide=structuralTieDistance(answer,reference);
	    queue.push({type: 'node', node: initial}, initial.h,0,initial.guide);
	    const trace = node => {
	        const result = [];
	        for (let n = node; n.previous; n = n.previous) result.push(n.edge);
	        return result.reverse();
	    };
	    const result = (node, capped = false) => ({
	        distance: capped ? cutoff : node.distance, edits: capped ? [] : trace(node), capped,
	        visited: settled, generated, frontier: queue.length,
	        search: unit || predicateUnit || work.enabled || relationUnit || sourceUnit ? 'exact-lazy-a-star' : 'exact-lazy-uniform-cost',
	        heuristic: unit || predicateUnit || work.enabled || relationUnit || sourceUnit ? 'admissible-sql-work-and-expression-bounds-v2' : 'zero',
	        startKey, destinationKey, finalKey: capped ? null : node.key,
	        limits: graph.limits
	    });
	    // A directly witnessed path supplies an upper bound. When its cost equals
	    // the certified GLOBAL lower bound at the start, it is already optimal:
	    // lowerBound <= shortestDistance <= directCost == lowerBound. This is an
	    // additional certificate, not a target-guided restriction of the graph.
	    // Otherwise the complete lazy search below remains unchanged. Use exact
	    // equality; approximate numeric agreement is not an optimality proof.
	    if (startKey !== destinationKey && Number.isFinite(initial.h) && initial.h >= 0 && initial.h < cutoff) {
	        context.frontier = queue.length;
	        context.lowerBound = initial.h;
	        const directEdits = graph.edits.filter(edit => Number.isSafeInteger(edit.cost) && edit.cost === initial.h)
	            .sort((a, b) => editOrder(a) - editOrder(b));
	        for (const edit of directEdits) {
	            await context.tick();
	            for (const neighbour of edit.apply(answer)) {
	                await context.tick();
	                ++generated;
	                const key = stableKey(neighbour.root);
	                if (key !== destinationKey) continue;
	                const next = {root: neighbour.root, key, distance: edit.cost, previous: initial,
	                    edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
	                        path: neighbour.operation?.path || [], operation: neighbour.operation}};
	                return {...result(next), frontier: 0,
	                    search: 'exact-direct-bound-certificate', heuristic: 'matching-global-start-lower-bound'};
	            }
	        }
	    }
	    // A witnessed all-zero path is optimal under ANY nonnegative edit costs.
	    // Two finite monotone scheduling passes can find such a certificate without
	    // expanding the whole free closure. Failure merely falls through to the
	    // complete search; these guides never supply a distance or a score.
	    if(startKey!==destinationKey&&initial.h===0)for(const weighted of [false,true]){
	        let node=initial,guide=structuralTieDistance(answer,reference,weighted);
	        while(guide>0){
	            let chosen=null,nextGuide=guide;
	            for(const edit of graph.edits)if(edit.cost===0){
	                await context.tick();
	                for(const edge of edit.apply(node.root)){
	                    await context.tick();const candidate=structuralTieDistance(edge.root,reference,weighted);
	                    if(candidate>=nextGuide)continue;
	                    nextGuide=candidate;chosen={root:edge.root,key:stableKey(edge.root),distance:0,previous:node,
	                        edge:{type:'sql-edit',name:edit.name,description:edit.description,cost:0,path:edge.operation.path,operation:edge.operation}};++generated;
	                }
	            }
	            if(!chosen)break;node=chosen;guide=nextGuide;
	            if(node.key===destinationKey)return {...result(node),frontier:0,search:'exact-zero-path-certificate',heuristic:'nonnegative-costs-and-witnessed-free-path'};
	        }
	    }
	    // Optional multi-edit upper witness. It may use a restricted, monotone
	    // scheduling pass because it NEVER defines the graph or an approximate
	    // grade. Only equality with the already certified GLOBAL lower bound can
	    // return a result. Otherwise the complete search below is unchanged.
	    if(Number.isSafeInteger(initial.h)&&initial.h>0&&initial.h<cutoff){
	        const seen=new Map();
	        const witness=async node=>{
	            if(node.key===destinationKey)return node.distance===initial.h?node:null;
	            const prior=seen.get(node.key);if(prior!==undefined&&prior<=node.distance)return null;seen.set(node.key,node.distance);
	            const candidates=[];
	            for(const edit of graph.edits){
	                if(node.distance+edit.cost>initial.h)continue;
	                if(node.distance+edit.cost+Math.max(0,node.bounds.budget-work.decrease(edit),
	                    node.bounds.predicates-(edit.maxNewPredicates||0)*predicateUnit,
	                    node.bounds.relations-(edit.maxNewRelations||0)*relationUnit,
	                    node.bounds.sources-(edit.maxNewSources||0)*sourceUnit)>initial.h)continue;
	                await context.tick();
	                for(const edge of edit.apply(node.root)){
	                    await context.tick();const guide=structuralTieDistance(edge.root,reference);
	                    if(guide>=node.guide)continue;
	                    const bounds=heuristic(edge.root),distance=node.distance+edit.cost;
	                    if(distance+Math.max(bounds.budget,bounds.predicates,bounds.relations,bounds.sources)>initial.h)continue;
	                    candidates.push({root:edge.root,key:stableKey(edge.root),distance,guide,bounds,previous:node,
	                        edge:{type:'sql-edit',name:edit.name,description:edit.description,cost:edit.cost,path:edge.operation.path,operation:edge.operation}});++generated;
	                }
	            }
	            candidates.sort((a,b)=>a.guide-b.guide||a.distance-b.distance);
	            for(const next of candidates){const found=await witness(next);if(found)return found;}
	            return null;
	        };
	        const found=await witness(initial);
	        if(found)return {...result(found),frontier:0,search:'exact-witness-bound-certificate',heuristic:'matching-global-start-lower-bound'};
	    }
	    while (queue.length) {
	        const entry = queue.pop(), task = entry.value, node = task.node;
	        if (best.get(node.key) !== node) continue;
	        context.frontier = queue.length + 1;
	        context.lowerBound = entry.priority;
	        await context.tick();
	        if (entry.priority >= cutoff) return result(node, true);
	        if (task.type === 'node') {
	            if (expanded.has(node.key) && expanded.get(node.key) <= node.distance) continue;
	            expanded.set(node.key, node.distance); ++settled; context.visited = settled;
	            if (node.key === destinationKey) return result(node);
	            // Lower bounds on each not-yet-generated edit's neighbours. This is
	            // the paper's lazy generation extended to an admissible heuristic.
	            const edits = graph.edits.map(edit => ({edit,
	                bound: node.distance + edit.cost + Math.max(0,
	                    node.bounds.budget - work.decrease(edit),
	                    node.bounds.predicates - (edit.maxNewPredicates || 0) * predicateUnit,
	                    node.bounds.relations-(edit.maxNewRelations||0)*relationUnit,
	                    node.bounds.sources-(edit.maxNewSources||0)*sourceUnit)
	            })).sort((a, b) => a.bound - b.bound || b.edit.cost - a.edit.cost || editOrder(a.edit) - editOrder(b.edit));
	            if (edits.length) queue.push({type: 'edit', node, edits, index: 0}, edits[0].bound, -node.distance - edits[0].edit.cost,node.guide);
	            continue;
	        }
	        const {edit} = task.edits[task.index];
	        if (!Number.isSafeInteger(node.distance + edit.cost)) throw new RangeError('The SQL-edit path exceeds exact integer distance precision.');
	        for (const neighbour of edit.apply(node.root)) {
	            await context.tick();
	            ++generated;
	            const key = stableKey(neighbour.root), distance = node.distance + edit.cost;
	            if (best.has(key) && best.get(key).distance <= distance) continue;
	            const bounds = heuristic(neighbour.root), h = Math.max(bounds.budget, bounds.predicates,bounds.relations,bounds.sources);
	            if (distance + h >= cutoff) continue;
	            const next = {root: neighbour.root, key, distance, h, bounds,guide:structuralTieDistance(neighbour.root,reference), previous: node,
	                edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
	                    path: neighbour.operation?.path || [], operation: neighbour.operation}};
	            // This task was the smallest lower bound in the entire queue. If a
	            // generated goal attains that bound, no ungenerated edge or queued
	            // state can yield a cheaper path. This is not greedy goal guidance.
	            if (key === destinationKey && distance <= entry.priority) return result(next);
	            best.set(key, next);
	            queue.push({type: 'node', node: next}, distance + h, -distance,next.guide);
	        }
	        if (++task.index < task.edits.length) queue.push(task, task.edits[task.index].bound, -node.distance - task.edits[task.index].edit.cost,node.guide);
	    }
	    // Every atomic grammar has a finite remove-to-empty/build-from-empty path.
	    // If pruning excluded all remaining nodes, their lower bound reached cutoff.
	    if (Number.isFinite(cutoff)) return result(initial, true);
	    throw new Error('The configured SQL-edit graph does not connect the supplied ASTs.');
	}

	class Hashable {
	    hash;
	    hashMax;
	    constructor(hash, hashMax){
	        this.hash = hash;
	        this.hashMax = hashMax;
	    }
	}

	class HeightInfo {
	    columnReferenceHeight;
	    literalHeight;
	    notHeight;
	    aggregationHeight;
	    binaryExpressionHeight;
	    constructor(columnReferenceHeight, literalHeight, notHeight, aggregationHeight, binaryExpressionHeight){
	        this.columnReferenceHeight = columnReferenceHeight;
	        this.literalHeight = literalHeight;
	        this.notHeight = notHeight;
	        this.aggregationHeight = aggregationHeight;
	        this.binaryExpressionHeight = binaryExpressionHeight;
	    }
	    minDiff(info) {
	        return Math.min(info.columnReferenceHeight < 0 ? Infinity : this.columnReferenceHeight - info.columnReferenceHeight, info.literalHeight < 0 ? Infinity : this.literalHeight - info.literalHeight, info.notHeight < 0 ? Infinity : this.notHeight - info.notHeight, info.aggregationHeight < 0 ? Infinity : this.aggregationHeight - info.aggregationHeight, info.binaryExpressionHeight < 0 ? Infinity : this.binaryExpressionHeight - info.binaryExpressionHeight);
	    }
	    static max(info1, info2) {
	        return new HeightInfo(Math.max(info1.columnReferenceHeight, info2.columnReferenceHeight), Math.max(info1.literalHeight, info2.literalHeight), Math.max(info1.notHeight, info2.notHeight), Math.max(info1.aggregationHeight, info2.aggregationHeight), Math.max(info1.binaryExpressionHeight, info2.binaryExpressionHeight));
	    }
	    static EMPTY = new HeightInfo(-1, -1, -1, -1, -1);
	    increase() {
	        return new HeightInfo(this.columnReferenceHeight >= 0 ? this.columnReferenceHeight + 1 : -1, this.literalHeight >= 0 ? this.literalHeight + 1 : -1, this.notHeight >= 0 ? this.notHeight + 1 : -1, this.aggregationHeight >= 0 ? this.aggregationHeight + 1 : -1, this.binaryExpressionHeight >= 0 ? this.binaryExpressionHeight + 1 : -1);
	    }
	}

	var ExpressionType = /*#__PURE__*/ function(ExpressionType) {
	    ExpressionType[ExpressionType["ASTERISK"] = 0] = "ASTERISK";
	    ExpressionType[ExpressionType["COLUMN_REFERENCE"] = 1] = "COLUMN_REFERENCE";
	    ExpressionType[ExpressionType["LITERAL"] = 2] = "LITERAL";
	    ExpressionType[ExpressionType["NOT"] = 3] = "NOT";
	    ExpressionType[ExpressionType["AGGREGATION"] = 4] = "AGGREGATION";
	    ExpressionType[ExpressionType["BINARY"] = 5] = "BINARY";
	    return ExpressionType;
	}({});
	class Expression extends Hashable {
	    height;
	    type;
	    constructor(hash, hashMax, height){
	        super(hash, hashMax), this.height = height;
	    }
	}
	class ExpressionContext {
	    stack;
	    query;
	    maxHeight;
	    constructor(stack, query, maxHeight){
	        this.stack = stack;
	        this.query = query;
	        this.maxHeight = maxHeight;
	    }
	}

	function append(target, source) {
	    let target_length = target.length, source_length = source.length;
	    target.length = target_length + source_length;
	    for(let i = 0; i < source_length; ++i){
	        target[target_length + i] = source[i];
	    }
	}
	const cyrb53 = function(str, seed = 0) {
	    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
	    for(let i = 0, ch; i < str.length; i++){
	        ch = str.charCodeAt(i);
	        h1 = Math.imul(h1 ^ ch, 2654435761);
	        h2 = Math.imul(h2 ^ ch, 1597334677);
	    }
	    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
	    h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
	    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
	    h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
	    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
	};

	class ColumnReference extends Expression {
	    column;
	    table;
	    type = ExpressionType.COLUMN_REFERENCE;
	    constructor(column, table = null){
	        super(cyrb53(column) + (table !== null ? 2 : 1), 3, ColumnReference.HEIGHT), this.column = column, this.table = table;
	    }
	    static HEIGHT = new HeightInfo(0, -1, -1, -1, -1);
	    equals(other, thisQuery, otherQuery) {
	        if (!ColumnReference.isColumnReference(other) || this.hash !== other.hash) return false;
	        if (this.column !== other.column) return false;
	        if (!thisQuery || !otherQuery) return false;
	        for(let f = 0, fl = Math.max(thisQuery.fromLength, otherQuery.fromLength); f < fl; ++f){
	            if ((f < thisQuery.fromLength && this.table === thisQuery.getFrom(f).alias) !== (f < otherQuery.fromLength && other.table === otherQuery.getFrom(f).alias)) return false;
	        }
	        return true;
	    }
	    setColumn(column) {
	        return new ColumnReference(column, this.table);
	    }
	    setTable(table) {
	        return new ColumnReference(this.column, table);
	    }
	    recursivelyReplace(_multimap, _context, _recursionDepth) {
	        return [];
	    }
	    static isColumnReference(e) {
	        return e !== null && e.type === ExpressionType.COLUMN_REFERENCE;
	    }
	}

	class Asterisk extends Expression {
	    table;
	    type = ExpressionType.ASTERISK;
	    constructor(table = null){
	        super(table !== null ? cyrb53(table) : 1, 3, ColumnReference.HEIGHT), this.table = table;
	    }
	    equals(other, thisQuery, otherQuery) {
	        if (!Asterisk.isAsterisk(other) || this.hash !== other.hash) return false;
	        if (!thisQuery || !otherQuery) return false;
	        for(let f = 0, fl = Math.max(thisQuery.fromLength, otherQuery.fromLength); f < fl; ++f){
	            if ((f < thisQuery.fromLength && this.table === thisQuery.getFrom(f).alias) !== (f < otherQuery.fromLength && other.table === otherQuery.getFrom(f).alias)) return false;
	        }
	        return true;
	    }
	    setTable(table) {
	        return new Asterisk(table);
	    }
	    recursivelyReplace(_multimap, _context, _recursionDepth) {
	        return [];
	    }
	    static baseAsterisk = new Asterisk();
	    static isAsterisk(e) {
	        return e !== null && e.type === ExpressionType.ASTERISK;
	    }
	}

	var AggregationType = /*#__PURE__*/ function(AggregationType) {
	    AggregationType[AggregationType["COUNT"] = 0] = "COUNT";
	    AggregationType[AggregationType["SUM"] = 1] = "SUM";
	    AggregationType[AggregationType["AVG"] = 2] = "AVG";
	    AggregationType[AggregationType["MIN"] = 3] = "MIN";
	    AggregationType[AggregationType["MAX"] = 4] = "MAX";
	    return AggregationType;
	}({});
	class AggregationFunction extends Expression {
	    aggregation;
	    distinct;
	    argument;
	    type = ExpressionType.AGGREGATION;
	    constructor(aggregation, distinct = false, argument = null){
	        super(((argument ? argument.hash : 0) * 5 + aggregation) * 2 + (distinct ? 1 : 0), (argument ? argument.hashMax : 1) * 5 * 2, argument ? HeightInfo.max(argument.height.increase(), AggregationFunction.EMPTY_HEIGHT) : AggregationFunction.EMPTY_HEIGHT), this.aggregation = aggregation, this.distinct = distinct, this.argument = argument;
	    }
	    static EMPTY_HEIGHT = new HeightInfo(-1, -1, -1, 0, -1);
	    equals(other, thisQuery, otherQuery) {
	        if (!AggregationFunction.isAggregationFunction(other) || this.hash !== other.hash) return false;
	        if (this.aggregation !== other.aggregation) return false;
	        if (!(this.argument === other.argument || this.argument && this.argument.equals(other.argument, thisQuery, otherQuery))) return false;
	        return true;
	    }
	    setAggregation(aggregation) {
	        return new AggregationFunction(aggregation, this.distinct, this.argument);
	    }
	    setDistinct(distinct) {
	        return new AggregationFunction(this.aggregation, distinct, this.argument);
	    }
	    setArgument(argument) {
	        return new AggregationFunction(this.aggregation, this.distinct, argument);
	    }
	    recursivelyReplace(multimap, context, recursionDepth) {
	        if (recursionDepth < 0) return [];
	        context.stack.push(this);
	        const res = [];
	        append(res, multimap(this.argument, context));
	        if (this.argument) {
	            append(res, this.argument.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        context.stack.pop();
	        for(let i = 0; i < res.length; ++i)res[i] = this.setArgument(res[i]);
	        return res;
	    }
	    static isAggregationFunction(e) {
	        return e !== null && e.type === ExpressionType.AGGREGATION;
	    }
	    static isDistinctValidFor(aggregation) {
	        switch(aggregation){
	            case 0:
	                return true;
	            default:
	                return false;
	        }
	    }
	}

	var OperatorType = /*#__PURE__*/ function(OperatorType) {
	    OperatorType[OperatorType["EQUALS"] = 0] = "EQUALS";
	    OperatorType[OperatorType["AND"] = 1] = "AND";
	    OperatorType[OperatorType["OR"] = 2] = "OR";
	    OperatorType[OperatorType["LESS"] = 3] = "LESS";
	    OperatorType[OperatorType["GREATER"] = 4] = "GREATER";
	    return OperatorType;
	}({});
	class BinaryExpression extends Expression {
	    operator;
	    left;
	    right;
	    type = ExpressionType.BINARY;
	    constructor(operator, left = null, right = null){
	        super(((right ? right.hash : 0) * (left ? left.hashMax : 1) + (left ? left.hash : 0)) * 5 + operator, (left ? left.hashMax : 1) * (right ? right.hashMax : 1) * 5, left && right ? HeightInfo.max(HeightInfo.max(left.height.increase(), right.height.increase()), BinaryExpression.EMPTY_HEIGHT) : left || right ? HeightInfo.max((left ? left : right).height.increase(), BinaryExpression.EMPTY_HEIGHT) : BinaryExpression.EMPTY_HEIGHT), this.operator = operator, this.left = left, this.right = right;
	    }
	    static EMPTY_HEIGHT = new HeightInfo(-1, -1, -1, -1, 0);
	    equals(other, thisQuery, otherQuery) {
	        if (!BinaryExpression.isBinaryExpression(other) || this.hash !== other.hash) return false;
	        if (this.operator !== other.operator) return false;
	        if (!(this.left === other.left || this.left && this.left.equals(other.left, thisQuery, otherQuery))) return false;
	        if (!(this.right === other.right || this.right && this.right.equals(other.right, thisQuery, otherQuery))) return false;
	        return true;
	    }
	    setOperator(operator) {
	        return new BinaryExpression(operator, this.left, this.right);
	    }
	    setLeft(left) {
	        return new BinaryExpression(this.operator, left, this.right);
	    }
	    setRight(right) {
	        return new BinaryExpression(this.operator, this.left, right);
	    }
	    recursivelyReplace(multimap, context, recursionDepth) {
	        if (recursionDepth < 0) return [];
	        context.stack.push(this);
	        const res = [];
	        append(res, multimap(this.left, context));
	        if (this.left) {
	            append(res, this.left.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        const left_length = res.length;
	        append(res, multimap(this.right, context));
	        if (this.right) {
	            append(res, this.right.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        const res_length = res.length;
	        context.stack.pop();
	        for(let i = 0; i < left_length; ++i)res[i] = this.setLeft(res[i]);
	        for(let i = left_length; i < res_length; ++i)res[i] = this.setRight(res[i]);
	        return res;
	    }
	    static baseBinaryExpressions = (()=>{
	        const res = [];
	        for(let item in OperatorType)if (isNaN(Number(item))) res.push(new BinaryExpression(OperatorType[item]));
	        return res;
	    })();
	    static isBinaryExpression(expression) {
	        return expression !== null && expression.type === ExpressionType.BINARY;
	    }
	    static isBoolean(operator) {
	        switch(operator){
	            case 1:
	            case 2:
	            case 0:
	                return true;
	            default:
	                return false;
	        }
	    }
	    static isCommutative(operator) {
	        switch(operator){
	            case 1:
	            case 2:
	            case 0:
	                return true;
	            default:
	                return false;
	        }
	    }
	    static isAssiciative(operator) {
	        switch(operator){
	            case 1:
	            case 2:
	                return true;
	            default:
	                return false;
	        }
	    }
	    static isDistributive(outer, inner) {
	        switch(outer){
	            case 1:
	                return inner == 2;
	            case 2:
	                return inner == 1;
	            default:
	                return false;
	        }
	    }
	}

	class SelectElement extends Hashable {
	    expression;
	    as;
	    constructor(expression = null, as = null){
	        super((expression ? expression.hash : 0) * 2 + (as != null ? 1 : 0), (expression ? expression.hashMax : 1) * 2), this.expression = expression, this.as = as;
	    }
	    equals(other, thisQuery, otherQuery) {
	        if (other === null || this.hash !== other.hash) return false;
	        if (!(this.expression === other.expression || this.expression && this.expression.equals(other.expression, thisQuery, otherQuery))) return false;
	        return true;
	    }
	    setExpression(expression) {
	        return new SelectElement(expression, this.as);
	    }
	    setAs(as) {
	        return new SelectElement(this.expression, as);
	    }
	    recursivelyReplaceExpression(multimap, recursionDepth, query, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], query, maxHeight);
	        const res = [];
	        append(res, multimap(this.expression, context));
	        if (this.expression) {
	            append(res, this.expression.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	}

	var JoinType = /*#__PURE__*/ function(JoinType) {
	    JoinType[JoinType["INNER"] = 0] = "INNER";
	    JoinType[JoinType["LEFT_OUTER"] = 1] = "LEFT_OUTER";
	    JoinType[JoinType["RIGHT_OUTER"] = 2] = "RIGHT_OUTER";
	    JoinType[JoinType["FULL_OUTER"] = 3] = "FULL_OUTER";
	    return JoinType;
	}({});
	class FromElement extends Hashable {
	    table;
	    join;
	    on;
	    as;
	    alias;
	    constructor(table, join = null, on = null, as = null){
	        super(((on ? on.hash : 0) * 2 + (as != null ? 1 : 0)) * 5 + (join != null ? join + 1 : 0), (on ? on.hashMax : 1) * 2 * 5), this.table = table, this.join = join, this.on = on, this.as = as;
	        this.alias = as || table;
	    }
	    equals(other, thisQuery, otherQuery) {
	        if (other === null || this.hash !== other.hash) return false;
	        if (this.table !== other.table) return false;
	        if (this.join !== other.join) return false;
	        if (!(this.on === other.on || this.on && this.on.equals(other.on, thisQuery, otherQuery))) return false;
	        if (this.as === null != (other.as === null)) return false;
	        return true;
	    }
	    setTable(table) {
	        return new FromElement(table, this.join, this.on, this.as);
	    }
	    setJoin(join) {
	        return new FromElement(this.table, join, this.on, this.as);
	    }
	    setOn(on) {
	        return new FromElement(this.table, this.join, on, this.as);
	    }
	    setAs(as) {
	        return new FromElement(this.table, this.join, this.on, as);
	    }
	    recursivelyReplaceOn(multimap, recursionDepth, query, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], query, maxHeight);
	        const res = [];
	        append(res, multimap(this.on, context));
	        if (this.on) {
	            append(res, this.on.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	}

	class OrderBy extends Hashable {
	    descending;
	    expression;
	    constructor(descending = false, expression = null){
	        super((expression ? expression.hash : 0) * 2 + (descending ? 1 : 0), (expression ? expression.hashMax : 1) * 2), this.descending = descending, this.expression = expression;
	    }
	    equals(other, thisQuery, otherQuery) {
	        if (other === null || this.hash !== other.hash) return false;
	        if (this.descending !== other.descending) return false;
	        if (!(this.expression === other.expression || this.expression && this.expression.equals(other.expression, thisQuery, otherQuery))) return false;
	        return true;
	    }
	    setDescending(descending) {
	        return new OrderBy(descending, this.expression);
	    }
	    setExpression(expression) {
	        return new OrderBy(this.descending, expression);
	    }
	    recursivelyReplaceExpression(multimap, recursionDepth, query, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], query, maxHeight);
	        const res = [];
	        append(res, multimap(this.expression, context));
	        if (this.expression) {
	            append(res, this.expression.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	    static baseOrderBy = new OrderBy();
	}

	class Literal extends Expression {
	    value;
	    type = ExpressionType.LITERAL;
	    constructor(value){
	        super(typeof value == "string" ? cyrb53(value) : value, 2, Literal.HEIGHT), this.value = value;
	    }
	    static HEIGHT = new HeightInfo(-1, 0, -1, -1, -1);
	    equals(other, thisQuery, otherQuery) {
	        if (!Literal.isLiteral(other) || this.hash !== other.hash) return false;
	        if (this.value !== other.value) return false;
	        return true;
	    }
	    setValue(value) {
	        return new Literal(value);
	    }
	    recursivelyReplace(_multimap, _context, _recursionDepth) {
	        return [];
	    }
	    static isLiteral(e) {
	        return e !== null && e.type === ExpressionType.LITERAL;
	    }
	}

	class Not extends Expression {
	    argument;
	    type = ExpressionType.NOT;
	    constructor(argument = null){
	        super((argument ? argument.hash : 0) * 2 + 1, (argument ? argument.hashMax : 1) * 2, argument ? HeightInfo.max(argument.height.increase(), Not.EMPTY_HEIGHT) : Not.EMPTY_HEIGHT), this.argument = argument;
	    }
	    static EMPTY_HEIGHT = new HeightInfo(-1, -1, 0, -1, -1);
	    equals(other, thisQuery, otherQuery) {
	        if (!Not.isNot(other) || this.hash !== other.hash) return false;
	        if (!(this.argument === other.argument || this.argument && this.argument.equals(other.argument, thisQuery, otherQuery))) return false;
	        return true;
	    }
	    setArgument(argument) {
	        return new Not(argument);
	    }
	    recursivelyReplace(multimap, context, recursionDepth) {
	        if (recursionDepth < 0) return [];
	        context.stack.push(this);
	        const res = [];
	        append(res, multimap(this.argument, context));
	        if (this.argument) {
	            append(res, this.argument.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        context.stack.pop();
	        for(let i = 0; i < res.length; ++i)res[i] = this.setArgument(res[i]);
	        return res;
	    }
	    static baseNot = new Not();
	    static isNot(e) {
	        return e !== null && e.type === ExpressionType.NOT;
	    }
	}

	class Query extends Hashable {
	    distinct;
	    select;
	    from;
	    where;
	    groupby;
	    having;
	    orderby;
	    constructor(distinct = false, select = [], from = [], where = null, groupby = [], having = null, orderby = []){
	        const selectLength = select.length;
	        const fromLength = from.length;
	        const groupbyLength = groupby.length;
	        const orderbyLength = orderby.length;
	        let hash = distinct ? 2 : 1;
	        hash = hash * 4 + selectLength;
	        for(let s = 0; s < selectLength; ++s){
	            const se = select[s];
	            hash = hash * se.hashMax + se.hash;
	        }
	        hash = hash * 4 + fromLength;
	        for(let f = 0; f < fromLength; ++f){
	            const fe = from[f];
	            hash = hash * fe.hashMax + fe.hash;
	        }
	        hash = where ? hash * where.hashMax + where.hash : hash;
	        hash = hash * 4 + groupbyLength;
	        for(let g = 0; g < groupbyLength; ++g){
	            const ge = groupby[g];
	            hash = ge ? hash * ge.hashMax + ge.hash : hash;
	        }
	        hash = having ? hash * having.hashMax + having.hash : hash;
	        hash = hash * 4 + orderbyLength;
	        for(let o = 0; o < orderbyLength; ++o){
	            const oe = orderby[o];
	            hash = hash * oe.hashMax + oe.hash;
	        }
	        super(hash, 1), this.distinct = distinct, this.select = select, this.from = from, this.where = where, this.groupby = groupby, this.having = having, this.orderby = orderby;
	        this.selectLength = selectLength;
	        this.fromLength = fromLength;
	        this.groupbyLength = groupbyLength;
	        this.orderbyLength = orderbyLength;
	    }
	    selectLength;
	    getSelect(i) {
	        return this.select[i];
	    }
	    copySelect() {
	        return this.select.slice();
	    }
	    fromLength;
	    getFrom(i) {
	        return this.from[i];
	    }
	    copyFrom() {
	        return this.from.slice();
	    }
	    groupbyLength;
	    getGroupby(i) {
	        return this.groupby[i];
	    }
	    copyGroupby() {
	        return this.groupby.slice();
	    }
	    orderbyLength;
	    getOrderby(i) {
	        return this.orderby[i];
	    }
	    copyOrderby() {
	        return this.orderby.slice();
	    }
	    equals(other) {
	        if (other === null || this.hash !== other.hash) return false;
	        if (this.distinct !== other.distinct) return false;
	        if (this.selectLength !== other.selectLength) return false;
	        if (this.fromLength !== other.fromLength) return false;
	        if (this.groupbyLength !== other.groupbyLength) return false;
	        if (this.orderbyLength !== other.orderbyLength) return false;
	        for(let i = 0, l = this.selectLength; i < l; ++i){
	            if (!this.select[i].equals(other.select[i], this, other)) return false;
	        }
	        for(let i = 0, l = this.fromLength; i < l; ++i){
	            if (!this.from[i].equals(other.from[i], this, other)) return false;
	        }
	        if (!(this.where == other.where || this.where !== null && this.where.equals(other.where, this, other))) return false;
	        for(let i = 0, l = this.groupbyLength; i < l; ++i){
	            if (!(this.groupby[i] === other.groupby[i] || this.groupby[i] && this.groupby[i].equals(other.groupby[i], this, other))) return false;
	        }
	        if (!(this.having == other.having || this.having !== null && this.having.equals(other.having, this, other))) return false;
	        for(let i = 0, l = this.orderbyLength; i < l; ++i){
	            if (!this.orderby[i].equals(other.orderby[i], this, other)) return false;
	        }
	        return true;
	    }
	    setDistinct(distinct) {
	        return new Query(distinct, this.select, this.from, this.where, this.groupby, this.having, this.orderby);
	    }
	    setSelect(select) {
	        return new Query(this.distinct, select.slice(), this.from, this.where, this.groupby, this.having, this.orderby);
	    }
	    setSelectElement(i = this.select.length, s = undefined, override = true) {
	        const select = this.copySelect();
	        if (s === undefined) select.splice(i, override ? 1 : 0);
	        else select.splice(i, override ? 1 : 0, s);
	        return new Query(this.distinct, select, this.from, this.where, this.groupby, this.having, this.orderby);
	    }
	    setFrom(from) {
	        return new Query(this.distinct, this.select, from.slice(), this.where, this.groupby, this.having, this.orderby);
	    }
	    setFromElement(i = this.from.length, f = undefined, override = true) {
	        const from = this.copyFrom();
	        if (f === undefined) from.splice(i, override ? 1 : 0);
	        else from.splice(i, override ? 1 : 0, f);
	        return new Query(this.distinct, this.select, from, this.where, this.groupby, this.having, this.orderby);
	    }
	    setWhere(where) {
	        return new Query(this.distinct, this.select, this.from, where, this.groupby, this.having, this.orderby);
	    }
	    setGroupby(groupby) {
	        return new Query(this.distinct, this.select, this.from, this.where, groupby.slice(), this.having, this.orderby);
	    }
	    setGroupbyElement(i = this.groupby.length, e = undefined, override = true) {
	        const groupby = this.copyGroupby();
	        if (e === undefined) groupby.splice(i, override ? 1 : 0);
	        else groupby.splice(i, override ? 1 : 0, e);
	        return new Query(this.distinct, this.select, this.from, this.where, groupby, this.having, this.orderby);
	    }
	    setHaving(having) {
	        return new Query(this.distinct, this.select, this.from, this.where, this.groupby, having, this.orderby);
	    }
	    setOrderby(orderby) {
	        return new Query(this.distinct, this.select, this.from, this.where, this.groupby, this.having, orderby.slice());
	    }
	    setOrderbyElement(i = this.orderby.length, o = undefined, override = true) {
	        const orderby = this.copyOrderby();
	        if (o == undefined) orderby.splice(i, override ? 1 : 0);
	        else orderby.splice(i, override ? 1 : 0, o);
	        return new Query(this.distinct, this.select, this.from, this.where, this.groupby, this.having, orderby);
	    }
	    recursivelyReplaceWhere(multimap, recursionDepth, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], this, maxHeight);
	        const res = [];
	        append(res, multimap(this.where, context));
	        if (this.where) {
	            append(res, this.where.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	    recursivelyReplaceGroupby(i, multimap, recursionDepth, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], this, maxHeight);
	        const res = [];
	        append(res, multimap(this.groupby[i], context));
	        if (this.groupby[i]) {
	            append(res, this.groupby[i].recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	    recursivelyReplaceHaving(multimap, recursionDepth, maxHeight = null) {
	        if (recursionDepth < 0) return [];
	        const context = new ExpressionContext([], this, maxHeight);
	        const res = [];
	        append(res, multimap(this.having, context));
	        if (this.having) {
	            append(res, this.having.recursivelyReplace(multimap, context, recursionDepth - 1));
	        }
	        return res;
	    }
	    validateSemantics(schema) {
	        const forbidAsterisk = (element)=>(x)=>{
	                if (Asterisk.isAsterisk(x)) throw new Error(element + " contains asterisk.");
	                return [];
	            };
	        const forbidAggregation = (element)=>(x)=>{
	                if (AggregationFunction.isAggregationFunction(x)) throw new Error(element + "contains aggregation function.");
	                return [];
	            };
	        const checkAsterisk = (element)=>(x)=>{
	                if (Asterisk.isAsterisk(x) && x.table != null) {
	                    let found = false;
	                    for(let f = 0; f < this.fromLength; ++f){
	                        if (this.from[f].alias == x.table) {
	                            found = true;
	                            break;
	                        }
	                    }
	                    if (!found) throw new Error(`${element} references all columns of table ` + `"${x.table}", which cannot be found within the from-elements.`);
	                }
	                return [];
	            };
	        const checkColumnReference = (element, checkGroupby, fromElements = this.fromLength)=>(x, context)=>{
	                if (ColumnReference.isColumnReference(x)) {
	                    let source = null;
	                    for(let f = 0; f < fromElements; ++f){
	                        let fe = this.from[f];
	                        if (x.table ? fe.alias == x.table : schema.get(fe.table).has(x.column)) {
	                            if (source == null) source = fe;
	                            else throw new Error(`${element} references column ` + `"${(x.table ? x.table + '.' : '') + x.column}", whose source is ambigous.`);
	                        }
	                    }
	                    if (source == null) throw new Error(`${element} references column ` + `"${(x.table ? x.table + '.' : '') + x.column}", which cannot be found ` + `within the (preceeding) from-elements.`);
	                    if (!schema.get(source.table).has(x.column)) throw new Error(element + ` references column "${(x.table ? x.table + '.' : '') + x.column}", which is` + ` not part of the schema.`);
	                    if (checkGroupby && this.groupbyLength) {
	                        let legal = false;
	                        for(let t = context.stack.length - 1; t >= 0; --t){
	                            if (AggregationFunction.isAggregationFunction(context.stack[t])) {
	                                legal = true;
	                                break;
	                            }
	                        }
	                        if (!legal) {
	                            for(let g = 0; g < this.groupbyLength; ++g){
	                                const ge = this.groupby[g];
	                                if (ColumnReference.isColumnReference(ge) && ge.column == x.column && (!ge.table || !x.table || ge.table == x.table)) {
	                                    legal = true;
	                                    break;
	                                }
	                            }
	                        }
	                        if (!legal) throw new Error(`${element} references column ` + `"${(x.table ? x.table + '.' : '') + x.column}", which is neither grouped by ` + `nor inside an aggregation function.`);
	                    }
	                }
	                return [];
	            };
	        const checkAggregationFunction = (element)=>(x, context)=>{
	                if (AggregationFunction.isAggregationFunction(x)) {
	                    if (x.argument == null && x.aggregation != AggregationType.COUNT) throw new Error(`${element} contains aggregation function without argument.`);
	                    for(let t = context.stack.length - 1; t >= 0; --t){
	                        if (AggregationFunction.isAggregationFunction(context.stack[t])) throw new Error(`${element} contains aggregation function ` + `inside another aggregation function`);
	                    }
	                }
	                return [];
	            };
	        const checkBinaryExpression = (element)=>(x)=>{
	                if (BinaryExpression.isBinaryExpression(x)) {
	                    if (x.left == null) throw new Error(`${element} contains binary expression without left argument.`);
	                    if (x.right == null) throw new Error(`${element} contains binary expression without right argument.`);
	                }
	                return [];
	            };
	        if (this.fromLength && this.from[0].join != null) throw new Error(`The first from-element cannot have a complex join-type.`);
	        for(let f = 0; f < this.fromLength; ++f){
	            const fe = this.from[f], name = `Join-condition of from-element ${f + 1}`;
	            if (!schema.has(fe.table)) throw new Error(`Table "${fe.table}" referenced by from-element ${f + 1} is not part of schema.`);
	            for(let f2 = f + 1; f2 < this.fromLength; ++f2){
	                if (fe.alias == this.from[f2].alias) throw new Error(`From-element ${f + 1} and ${f2 + 1} have the same table name/alias.`);
	            }
	            if (fe.join != null && fe.on == null) throw new Error(`From-element ${f + 1} has complex join-type but no join-condition.`);
	            if (fe.join == null && fe.on != null) throw new Error(`From-element ${f + 1} has join-condition but no complex join-type.`);
	            fe.recursivelyReplaceOn(forbidAsterisk(name), Infinity, this);
	            fe.recursivelyReplaceOn(checkColumnReference(name, false, f + 1), Infinity, this);
	            fe.recursivelyReplaceOn(forbidAggregation(name), Infinity, this);
	            fe.recursivelyReplaceOn(checkBinaryExpression(name), Infinity, this);
	        }
	        this.recursivelyReplaceWhere(forbidAsterisk("Where-clause"), Infinity, null);
	        this.recursivelyReplaceWhere(checkColumnReference("Where-clause", false), Infinity, null);
	        this.recursivelyReplaceWhere(forbidAggregation("Where-clause"), Infinity, null);
	        this.recursivelyReplaceWhere(checkBinaryExpression("Where-clause"), Infinity, null);
	        for(let g = 0; g < this.groupbyLength; ++g){
	            const name = `Group-by expression ${g + 1}`;
	            this.recursivelyReplaceGroupby(g, forbidAsterisk(name), Infinity, null);
	            this.recursivelyReplaceGroupby(g, checkColumnReference(name, false), Infinity, null);
	            this.recursivelyReplaceGroupby(g, forbidAggregation(name), Infinity, null);
	            this.recursivelyReplaceGroupby(g, checkBinaryExpression(name), Infinity, null);
	        }
	        if (this.having != null && this.groupbyLength == 0) throw new Error(`Query contains having-clause without group-by-clause.`);
	        this.recursivelyReplaceHaving(forbidAsterisk("Having-clause"), Infinity, null);
	        this.recursivelyReplaceHaving(checkColumnReference("Having-clause", true), Infinity, null);
	        this.recursivelyReplaceHaving(checkAggregationFunction("Having-clause"), Infinity, null);
	        this.recursivelyReplaceHaving(checkBinaryExpression("Having-clause"), Infinity, null);
	        selectLoop: for(let s = 0; s < this.selectLength; ++s){
	            const se = this.select[s], name = `Select-element ${s + 1}`;
	            if (se.as != null) {
	                for(let s2 = s + 1; s2 < this.selectLength; ++s2){
	                    if (se.as == this.select[s2].as) throw new Error(`Select-element ${s + 1} and ${s2 + 1} have the same alias.`);
	                }
	            }
	            for(let g = 0; g < this.groupbyLength; ++g){
	                if (se.expression == this.groupby[g] || se.expression && se.expression.equals(this.groupby[g], this, this)) continue selectLoop;
	            }
	            se.recursivelyReplaceExpression(checkAsterisk(name), Infinity, this);
	            se.recursivelyReplaceExpression(checkColumnReference(name, true), Infinity, this);
	            se.recursivelyReplaceExpression(checkAggregationFunction(name), Infinity, this);
	            se.recursivelyReplaceExpression(checkBinaryExpression(name), Infinity, this);
	        }
	        orderbyLoop: for(let o = 0; o < this.orderbyLength; ++o){
	            const oe = this.orderby[o], name = `Order-by-element ${o + 1}`;
	            for(let g = 0; g < this.groupbyLength; ++g){
	                if (oe.expression == this.groupby[g] || oe.expression && oe.expression.equals(this.groupby[g], this, this)) continue orderbyLoop;
	            }
	            oe.recursivelyReplaceExpression(checkAsterisk(name), Infinity, this);
	            oe.recursivelyReplaceExpression(checkColumnReference(name, true), Infinity, this);
	            oe.recursivelyReplaceExpression(checkAggregationFunction(name), Infinity, this);
	            oe.recursivelyReplaceExpression(checkBinaryExpression(name), Infinity, this);
	        }
	        return true;
	    }
	}

	class Schema extends Map {
	    static collectAllColumnReferences(query) {
	        const columnReferences = [];
	        const collect = (x)=>{
	            if (ColumnReference.isColumnReference(x)) columnReferences.push(x);
	            return [];
	        };
	        for(let s = 0; s < query.selectLength; ++s)query.getSelect(s).recursivelyReplaceExpression(collect, Infinity, query);
	        for(let f = 0; f < query.fromLength; ++f)query.getFrom(f).recursivelyReplaceOn(collect, Infinity, query);
	        query.recursivelyReplaceWhere(collect, Infinity);
	        for(let g = 0; g < query.groupbyLength; ++g)query.recursivelyReplaceGroupby(g, collect, Infinity);
	        query.recursivelyReplaceHaving(collect, Infinity);
	        for(let o = 0; o < query.orderbyLength; ++o)query.getOrderby(o).recursivelyReplaceExpression(collect, Infinity, query);
	        return columnReferences;
	    }
	    static deduceSchema(query) {
	        if (!query) throw new Error("Query required to deduce the schema from.");
	        const schema = new Schema();
	        const columnReferences = Schema.collectAllColumnReferences(query);
	        for(let f = 0; f < query.fromLength; ++f){
	            const table = Object.assign(new Map(), {
	                name: query.getFrom(f).table
	            });
	            schema.set(table.name, table);
	            for(let c = 0; c < columnReferences.length; ++c){
	                if (!columnReferences[c].table || columnReferences[c].table == query.getFrom(f).alias) table.set(columnReferences[c].column, {
	                    name: columnReferences[c].column
	                });
	            }
	        }
	        return schema;
	    }
	}

	class MetaInfo {
	    distinct;
	    select;
	    from;
	    where;
	    groupby;
	    having;
	    orderby;
	    constructor(query, schema){
	        this.distinct = query.distinct;
	        this.select = new SelectMetaInfo(query, schema);
	        this.from = new FromMetaInfo(query);
	        this.where = new WhereMetaInfo(query);
	        this.groupby = new GroupByMetaInfo(query);
	        this.having = new HavingMetaInfo(query);
	        this.orderby = new OrderByMetaInfo(query);
	    }
	}
	class SelectMetaInfo extends HeightInfo {
	    length;
	    asterisk;
	    columns;
	    literals;
	    aggregations;
	    as;
	    constructor(query, schema){
	        let maxHeights = HeightInfo.EMPTY;
	        let length = query.selectLength;
	        let columns = new Array();
	        let literals = new Array();
	        let aggregations = new Array();
	        let asterisks = new Array();
	        let as = new Array();
	        for(let s = 0; s < query.selectLength; ++s){
	            const se = query.getSelect(s);
	            if (se.expression) maxHeights = HeightInfo.max(maxHeights, se.expression.height);
	            se.recursivelyReplaceExpression(collect(query, columns, literals, aggregations, asterisks), Infinity, query);
	            if (se.as != null && !containsPrimitive(as, se.as)) as.push(se.as);
	        }
	        for(let a = 0, n = asterisks.length; a < n; ++a){
	            const as = asterisks[a];
	            if (as.table == null) {
	                if (query.groupbyLength > 0) {
	                    length += query.groupbyLength - 1;
	                    for(let g = 0; g < query.groupbyLength; ++g){
	                        query.recursivelyReplaceGroupby(g, collect(query, columns, literals, aggregations, null), Infinity);
	                    }
	                } else {
	                    for(let f = 0; f < query.fromLength; ++f){
	                        const table = schema.get(query.getFrom(f).table);
	                        if (!table) continue;
	                        length += table.size;
	                        for (let [c] of table){
	                            const cr = new ColumnReference(c);
	                            if (!containsExpression(columns, cr, query)) columns.push(cr);
	                        }
	                    }
	                    --length;
	                }
	            } else {
	                let t = as.table;
	                for(let f = 0; f < query.fromLength; ++f){
	                    const fe = query.getFrom(f);
	                    if (fe.alias == t) {
	                        t = fe.table;
	                        break;
	                    }
	                }
	                const table = schema.get(t);
	                if (!table) continue;
	                length += table.size - 1;
	                for (let [c] of table){
	                    const cr = new ColumnReference(c);
	                    if (!containsExpression(columns, cr, query)) columns.push(cr);
	                }
	            }
	        }
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.length = length;
	        this.asterisk = asterisks.length > 0;
	        this.columns = columns;
	        this.literals = literals;
	        this.aggregations = aggregations;
	        this.as = as;
	    }
	}
	class FromMetaInfo extends HeightInfo {
	    length;
	    join;
	    columns;
	    literals;
	    tables;
	    constructor(query){
	        let maxHeights = HeightInfo.EMPTY;
	        let join = false;
	        let columns = new Array();
	        let literals = new Array();
	        let tables = new Array();
	        for(let f = 0; f < query.fromLength; ++f){
	            const fe = query.getFrom(f);
	            if (fe.join != null) join = true;
	            if (fe.on) maxHeights = HeightInfo.max(maxHeights, fe.on.height);
	            fe.recursivelyReplaceOn(collect(query, columns, literals, [], []), Infinity, query);
	            if (fe.table && !containsPrimitive(tables, fe.table)) tables.push(fe.table);
	        }
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.length = query.fromLength;
	        this.join = join;
	        this.columns = columns;
	        this.literals = literals;
	        this.tables = tables;
	    }
	}
	class WhereMetaInfo extends HeightInfo {
	    columns;
	    literals;
	    constructor(query){
	        let maxHeights = HeightInfo.EMPTY;
	        let columns = new Array();
	        let literals = new Array();
	        if (query.where) maxHeights = query.where.height;
	        query.recursivelyReplaceWhere(collect(query, columns, literals, [], []), Infinity);
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.columns = columns;
	        this.literals = literals;
	    }
	}
	class GroupByMetaInfo extends HeightInfo {
	    length;
	    columns;
	    literals;
	    constructor(query){
	        let maxHeights = HeightInfo.EMPTY;
	        let columns = new Array();
	        let literals = new Array();
	        for(let g = 0; g < query.groupbyLength; ++g){
	            const x = query.getGroupby(g);
	            if (x) maxHeights = HeightInfo.max(maxHeights, x.height);
	            query.recursivelyReplaceGroupby(g, collect(query, columns, literals, [], []), Infinity);
	        }
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.length = query.groupbyLength;
	        this.columns = columns;
	        this.literals = literals;
	    }
	}
	class HavingMetaInfo extends HeightInfo {
	    columns;
	    literals;
	    aggregations;
	    constructor(query){
	        let maxHeights = HeightInfo.EMPTY;
	        let columns = new Array();
	        let literals = new Array();
	        let aggregations = new Array();
	        if (query.having) maxHeights = query.having.height;
	        query.recursivelyReplaceHaving(collect(query, columns, literals, aggregations, []), Infinity);
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.columns = columns;
	        this.literals = literals;
	        this.aggregations = aggregations;
	    }
	}
	class OrderByMetaInfo extends HeightInfo {
	    length;
	    columns;
	    literals;
	    aggregations;
	    constructor(query){
	        let maxHeights = HeightInfo.EMPTY;
	        let columns = new Array();
	        let literals = new Array();
	        let aggregations = new Array();
	        for(let o = 0; o < query.orderbyLength; ++o){
	            const oe = query.getOrderby(o);
	            if (oe.expression) maxHeights = HeightInfo.max(maxHeights, oe.expression.height);
	            oe.recursivelyReplaceExpression(collect(query, columns, literals, aggregations, []), Infinity, query);
	        }
	        super(maxHeights.columnReferenceHeight, maxHeights.literalHeight, maxHeights.notHeight, maxHeights.aggregationHeight, maxHeights.binaryExpressionHeight);
	        this.length = query.orderbyLength;
	        this.columns = columns;
	        this.literals = literals;
	        this.aggregations = aggregations;
	    }
	}
	function collect(query, columns, literals, aggregations, asterisks) {
	    return (x)=>{
	        if (Asterisk.isAsterisk(x)) {
	            asterisks.push(x);
	        } else if (ColumnReference.isColumnReference(x)) {
	            const cleanX = new ColumnReference(x.column);
	            if (!containsExpression(columns, cleanX, query)) columns.push(cleanX);
	        } else if (Literal.isLiteral(x)) {
	            const cleanX = new Literal(x.value);
	            if (!containsExpression(literals, cleanX, query)) literals.push(cleanX);
	        } else if (AggregationFunction.isAggregationFunction(x)) {
	            const cleanX = new AggregationFunction(x.aggregation);
	            if (!containsExpression(aggregations, cleanX, query)) aggregations.push(cleanX);
	        }
	        return [];
	    };
	}
	function containsExpression(list, x, q) {
	    for(let i = 0; i < list.length; ++i){
	        if (list[i].equals(x, q, q)) return true;
	    }
	    return false;
	}
	function containsPrimitive(list, x) {
	    for(let i = 0; i < list.length; ++i){
	        if (list[i] == x) return true;
	    }
	    return false;
	}

	function addEdit(set, edit) {
	    if (set.has(edit.name)) throw new Error(`Edit ${edit.name} already exists.`);
	    if (edit.cost % 1 !== 0) throw new Error(`Edit cost ${edit.cost} is not an integer.`);
	    set.set(edit.name, edit);
	}

	const atomicEdits = new Map();
	function addAsterisk(x) {
	    return x == null ? [
	        Asterisk.baseAsterisk
	    ] : [];
	}
	function removeAsterisk(x) {
	    return Asterisk.isAsterisk(x) ? [
	        null
	    ] : [];
	}
	function setAsteriskTable(x, context) {
	    if (!Asterisk.isAsterisk(x) || x.table) return [];
	    const res = new Array(context.query.fromLength);
	    for(let f = 0; f < context.query.fromLength; ++f){
	        res[f] = x.setTable(context.query.getFrom(f).alias);
	    }
	    return res;
	}
	function unsetAsteriskTable(x, context) {
	    return Asterisk.isAsterisk(x) && x.table ? [
	        x.setTable(null)
	    ] : [];
	}
	function addColumnReference(columnReferences) {
	    return (x)=>x == null ? columnReferences : [];
	}
	function removeColumnReference(x) {
	    return ColumnReference.isColumnReference(x) ? [
	        null
	    ] : [];
	}
	function setColumnReferenceTable(x, context) {
	    if (!ColumnReference.isColumnReference(x) || x.table) return [];
	    const res = new Array(context.query.fromLength);
	    for(let f = 0; f < context.query.fromLength; ++f){
	        res[f] = x.setTable(context.query.getFrom(f).alias);
	    }
	    return res;
	}
	function unsetColumnReferenceTable(x) {
	    return ColumnReference.isColumnReference(x) && x.table ? [
	        x.setTable(null)
	    ] : [];
	}
	function addLiteral(literals) {
	    return (x)=>x == null ? literals : [];
	}
	function removeLiteral(x) {
	    return Literal.isLiteral(x) ? [
	        null
	    ] : [];
	}
	function addNot(x, context) {
	    if (x != null && context.maxHeight.minDiff(x.height) < context.stack.length + 1) return [];
	    return x != null ? [
	        new Not(x)
	    ] : [
	        Not.baseNot
	    ];
	}
	function removeNot(x) {
	    return Not.isNot(x) ? [
	        x.argument
	    ] : [];
	}
	function addAggregationFunction(aggregations) {
	    return (x, context)=>{
	        if (x != null && context.maxHeight.minDiff(x.height) < context.stack.length + 1) return [];
	        if (x != null && x.height.aggregationHeight >= 0) return [];
	        for(let t = 0, n = context.stack.length; t < n; ++t){
	            if (AggregationFunction.isAggregationFunction(context.stack[t])) return [];
	        }
	        const res = new Array(aggregations.length);
	        for(let a = 0, n = aggregations.length; a < n; ++a){
	            res[a] = x != null ? aggregations[a].setArgument(x) : aggregations[a];
	        }
	        return res;
	    };
	}
	function removeAggregationFunction(x) {
	    return AggregationFunction.isAggregationFunction(x) ? [
	        x.argument
	    ] : [];
	}
	function setAggregationFunctionDistinct(x) {
	    return AggregationFunction.isAggregationFunction(x) && AggregationFunction.isDistinctValidFor(x.aggregation) && !x.distinct ? [
	        x.setDistinct(true)
	    ] : [];
	}
	function unsetAggregationFunctionDistinct(x) {
	    return AggregationFunction.isAggregationFunction(x) && x.distinct ? [
	        x.setDistinct(false)
	    ] : [];
	}
	function addBaseBinaryExpression(x, context) {
	    if (x != null && context.maxHeight.minDiff(x.height) < context.stack.length + 1) return [];
	    const res = new Array(BinaryExpression.baseBinaryExpressions.length);
	    for(let b = 0, n = BinaryExpression.baseBinaryExpressions.length; b < n; ++b){
	        if (x == null) {
	            res[b] = BinaryExpression.baseBinaryExpressions[b];
	        } else {
	            res[b] = BinaryExpression.baseBinaryExpressions[b].setLeft(x);
	            res.push(BinaryExpression.baseBinaryExpressions[b].setRight(x));
	        }
	    }
	    return res;
	}
	function removeBinaryExpression(x) {
	    return BinaryExpression.isBinaryExpression(x) && (x.left == null || x.right == null) ? [
	        x.left != null ? x.left : x.right
	    ] : [];
	}
	addEdit(atomicEdits, {
	    name: "setDistinct",
	    description: "Set (missing) distinct-declaration",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        if (!meta.distinct || query.distinct == true) return;
	        result.push(query.setDistinct(true));
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetDistinct",
	    description: "Unset (excess) distinct-declaration",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        if (meta.distinct || query.distinct == false) return;
	        result.push(query.setDistinct(false));
	    }
	});
	function replaceSelectExpression(query, result, multimap, selectLength, recursionDepth, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    for(let s = 0; s < query.selectLength && s < selectLength; ++s){
	        const select = query.getSelect(s);
	        const expressions = select.recursivelyReplaceExpression(multimap, recursionDepth, query, maxHeight);
	        for(let e = 0, n = expressions.length; e < n; ++e){
	            result.push(query.setSelectElement(s, select.setExpression(expressions[e])));
	        }
	    }
	}
	addEdit(atomicEdits, {
	    name: "addSelectElement",
	    description: "Add (missing) element in select-clause",
	    cost: 1,
	    perform: (query, schema, meta, result)=>{
	        if (new SelectMetaInfo(query, schema).length >= Math.max(meta.select.length, 1) || query.fromLength <= 0) return;
	        for(let s = 0; s <= query.selectLength; ++s){
	            result.push(query.setSelectElement(s, new SelectElement(), false));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectElement",
	    description: "Remove (excess) element in select-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let s = 0; s < query.selectLength; ++s){
	            result.push(query.setSelectElement(s, undefined));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectAsterisk",
	    description: "Add (missing) asterisk-selection to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        if (!meta.select.asterisk) return;
	        replaceSelectExpression(query, result, addAsterisk, meta.select.length, 1);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectAsterisk",
	    description: "Remove (excess) asterisk-selection from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeAsterisk, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setSelectAsteriskTable",
	    description: "Set (missing) table name on an asterisk in a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, setAsteriskTable, meta.select.length, meta.select.asterisk ? 1 : 0);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetSelectAsteriskTable",
	    description: "Unset (excess) table name on an asterisk in a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, unsetAsteriskTable, meta.select.length, meta.select.asterisk ? 1 : 0);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectColumnReference",
	    description: "Add (missing) column-reference to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, addColumnReference(meta.select.columns), meta.select.length, meta.select.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectColumnReference",
	    description: "Remove (excess) column-reference from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeColumnReference, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setSelectColumnReferenceTable",
	    description: "Set (missing) table name on a column-reference in a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, setColumnReferenceTable, meta.select.length, meta.select.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetSelectColumnReferenceTable",
	    description: "Unset (excess) table name on a column-reference in a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, unsetColumnReferenceTable, meta.select.length, meta.select.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectLiteral",
	    description: "Add (missing) literal to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, addLiteral(meta.select.literals), meta.select.length, meta.select.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectLiteral",
	    description: "Remove (excess) literal from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeLiteral, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectNot",
	    description: "Add (missing) NOT to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, addNot, meta.select.length, meta.select.notHeight, meta.select);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectNot",
	    description: "Remove (excess) NOT from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeNot, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectAggregationFunction",
	    description: "Add (missing) aggregation-function to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, addAggregationFunction(meta.select.aggregations), meta.select.length, meta.select.aggregationHeight, meta.select);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectAggregationFunction",
	    description: "Remove (excess) aggregation-function from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeAggregationFunction, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setSelectAggregationFunctionDistinct",
	    description: "Set (missing) distinct-declaration on an aggregation-function " + "in a select-element expression",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, setAggregationFunctionDistinct, meta.select.length, meta.select.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetSelectAggregationFunctionDistinct",
	    description: "Unset (excess) distinct-declaration on an aggregation-function " + "in a select-element expression",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, unsetAggregationFunctionDistinct, meta.select.length, meta.select.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addSelectBinaryExpression",
	    description: "Add (missing) binary-expression to a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, addBaseBinaryExpression, meta.select.length, meta.select.binaryExpressionHeight, meta.select);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeSelectBinaryExpression",
	    description: "Remove (excess) binary-expression from a select-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, removeBinaryExpression, meta.select.length, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setSelectAlias",
	    description: "Set (missing) explicit alias on a select-element",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        if (meta.select.as.length <= 0) return;
	        for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	            const select = query.getSelect(s);
	            if (select.as != null) continue;
	            for(let a = 0, n = meta.select.as.length; a < n; ++a){
	                result.push(query.setSelectElement(s, select.setAs(meta.select.as[a])));
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetSelectAlias",
	    description: "Unset (excess) explicit alias on a select-element",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	            const select = query.getSelect(s);
	            if (select.as != null) result.push(query.setSelectElement(s, select.setAs(null)));
	        }
	    }
	});
	function replaceFromExpression(query, result, multimap, recursionDepth, applyToFirst = false, applyWithoutComplexJoin = false, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    for(let f = applyToFirst ? 0 : 1; f < query.fromLength; ++f){
	        const from = query.getFrom(f);
	        if (!(applyWithoutComplexJoin || from.join != null)) continue;
	        const expressions = from.recursivelyReplaceOn(multimap, recursionDepth, query, maxHeight);
	        for(let e = 0, n = expressions.length; e < n; ++e){
	            result.push(query.setFromElement(f, from.setOn(expressions[e])));
	        }
	    }
	}
	addEdit(atomicEdits, {
	    name: "addFromElement",
	    description: "Add (missing) element in from-clause",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        if (query.fromLength >= meta.from.length) return;
	        for(let f = 0; f <= query.fromLength; ++f){
	            for (let table of meta.from.tables){
	                result.push(query.setFromElement(f, new FromElement(table), false));
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeFromElement",
	    description: "Remove (excess) element in from-clause",
	    cost: 2,
	    perform: (query, _schema, _meta, result)=>{
	        for(let f = 0; f < query.fromLength; ++f){
	            result.push(query.setFromElement(f, undefined));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "setTableJoinType",
	    description: "Set complex join-type on a from-element (change cross join to a complex join)",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        if (!meta.from.join) return;
	        for(let f = 1; f < query.fromLength; ++f){
	            const from = query.getFrom(f);
	            if (from.join != null) continue;
	            for(let item in JoinType){
	                if (isNaN(Number(item))) {
	                    result.push(query.setFromElement(f, from.setJoin(JoinType[item])));
	                }
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetTableJoinType",
	    description: "Unset complex join-type on a from-element (change complex join to cross join)",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let f = 0; f < query.fromLength; ++f){
	            const from = query.getFrom(f);
	            if (from.join != null) {
	                result.push(query.setFromElement(f, from.setJoin(null)));
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "addFromColumnReference",
	    description: "Add (missing) column-reference to a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, addColumnReference(meta.from.columns), meta.from.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeFromColumnReference",
	    description: "Remove (excess) column-reference from a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceFromExpression(query, result, removeColumnReference, Infinity, true, true);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setFromColumnReferenceTable",
	    description: "Set (missing) table name on a column-reference in a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, setColumnReferenceTable, meta.from.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetFromColumnReferenceTable",
	    description: "Unset (excess) table name on a column-reference in a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, unsetColumnReferenceTable, meta.from.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addFromLiteral",
	    description: "Add (missing) literal to a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, addLiteral(meta.from.literals), meta.from.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeFromLiteral",
	    description: "Remove (excess) literal from a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceFromExpression(query, result, removeLiteral, Infinity, true, true);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addFromNot",
	    description: "Add (missing) NOT to a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, addNot, meta.from.notHeight, false, false, meta.from);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeFromNot",
	    description: "Remove (excess) NOT from a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceFromExpression(query, result, removeNot, Infinity, true, true);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addFromBinaryExpression",
	    description: "Add (missing) binary-expression to a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, addBaseBinaryExpression, meta.from.binaryExpressionHeight, false, false, meta.from);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeFromBinaryExpression",
	    description: "Remove (excess) binary-expression from a from-element join-condition",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceFromExpression(query, result, removeBinaryExpression, Infinity, true, true);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setFromAlias",
	    description: "Set (missing) explicit alias on from-element",
	    cost: 1,
	    perform: (query, schema, _meta, result)=>{
	        for(let f = 0; f < query.fromLength; ++f){
	            const from = query.getFrom(f);
	            if (from.as !== null || !schema.has(from.table)) continue;
	            let as = schema.get(from.table).name.charAt(0);
	            let asNr = 0;
	            for(let exists = true; exists; asNr++){
	                exists = false;
	                for(let f2 = 0; f2 < query.fromLength; ++f2){
	                    if (query.getFrom(f2).as == as + asNr) {
	                        exists = true;
	                        break;
	                    }
	                }
	            }
	            result.push(query.setFromElement(f, from.setAs(as + asNr)));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetFromAlias",
	    description: "Remove (excess) explicit alias from from-element",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let f = 0; f < query.fromLength; ++f){
	            const from = query.getFrom(f);
	            if (from.as !== null) {
	                result.push(query.setFromElement(f, from.setAs(null)));
	            }
	        }
	    }
	});
	function replaceWhereExpression(query, result, multimap, recursionDepth, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    const expressions = query.recursivelyReplaceWhere(multimap, recursionDepth, maxHeight);
	    for(let e = 0, n = expressions.length; e < n; ++e){
	        result.push(query.setWhere(expressions[e]));
	    }
	}
	addEdit(atomicEdits, {
	    name: "addWhereColumnReference",
	    description: "Add (missing) column-reference to the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, addColumnReference(meta.where.columns), meta.where.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeWhereColumnReference",
	    description: "Remove (excess) column-reference from the where-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceWhereExpression(query, result, removeColumnReference, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setWhereColumnReferenceTable",
	    description: "Set (missing) table name on a column-reference in the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, setColumnReferenceTable, meta.where.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetWhereColumnReferenceTable",
	    description: "Unset (excess) table name on a column-reference in the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, unsetColumnReferenceTable, meta.where.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addWhereLiteral",
	    description: "Add (missing) literal to the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, addLiteral(meta.where.literals), meta.where.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeWhereLiteral",
	    description: "Remove (excess) literal from the where-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceWhereExpression(query, result, removeLiteral, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addWhereNot",
	    description: "Add (missing) NOT to the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, addNot, meta.where.notHeight, meta.where);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeWhereNot",
	    description: "Remove (excess) NOT from the where-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceWhereExpression(query, result, removeNot, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addWhereBinaryExpression",
	    description: "Add (missing) binary-expression to the where-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, addBaseBinaryExpression, meta.where.binaryExpressionHeight, meta.where);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeWhereBinaryExpression",
	    description: "Remove (excess) binary-expression from the where-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceWhereExpression(query, result, removeBinaryExpression, Infinity);
	    }
	});
	function replaceGroupbyExpression(query, result, multimap, recursionDepth, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    for(let g = 0; g < query.groupbyLength; ++g){
	        const expressions = query.recursivelyReplaceGroupby(g, multimap, recursionDepth, maxHeight);
	        for(let e = 0, n = expressions.length; e < n; ++e){
	            result.push(query.setGroupbyElement(g, expressions[e]));
	        }
	    }
	}
	addEdit(atomicEdits, {
	    name: "addGroupbyElement",
	    description: "Add (missing) element in group-by-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        if (query.groupbyLength >= meta.groupby.length) return;
	        for(let g = 0; g <= query.groupbyLength; ++g){
	            result.push(query.setGroupbyElement(g, null, false));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeGroupbyElement",
	    description: "Remove (excess) element in group-by-clause",
	    cost: 2,
	    perform: (query, _schema, _meta, result)=>{
	        for(let g = 0; g < query.groupbyLength; ++g){
	            result.push(query.setGroupbyElement(g, undefined));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "addGroupbyColumnReference",
	    description: "Add (missing) column reference to a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, addColumnReference(meta.groupby.columns), meta.groupby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeGroupbyColumnReference",
	    description: "Remove (excess) column-reference from a group-by expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceGroupbyExpression(query, result, removeColumnReference, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setGroupbyColumnReferenceTable",
	    description: "Set (missing) table name on a column reference in a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, setColumnReferenceTable, meta.groupby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetGroupbyColumnReferenceTable",
	    description: "Unset (excess) table name on a column reference in a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, unsetColumnReferenceTable, meta.groupby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addGroupbyLiteral",
	    description: "Add (missing) literal to a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, addLiteral(meta.groupby.literals), meta.groupby.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeGroupbyLiteral",
	    description: "Remove (excess) literal from a group-by expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceGroupbyExpression(query, result, removeLiteral, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addGroupbyNot",
	    description: "Add (missing) NOT to a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, addNot, meta.groupby.notHeight, meta.groupby);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeGroupbyNot",
	    description: "Remove (excess) NOT from a group-by expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceGroupbyExpression(query, result, removeNot, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addGroupbyBinaryExpression",
	    description: "Add (missing) binary expression to a group-by expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, addBaseBinaryExpression, meta.groupby.columnReferenceHeight, meta.groupby);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeGroupbyBinaryExpression",
	    description: "Remove (excess) binary-expression from a group-by expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceGroupbyExpression(query, result, removeBinaryExpression, Infinity);
	    }
	});
	function replaceHavingExpression(query, result, multimap, recursionDepth, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    const expressions = query.recursivelyReplaceHaving(multimap, recursionDepth, maxHeight);
	    for(let e = 0, n = expressions.length; e < n; ++e){
	        result.push(query.setHaving(expressions[e]));
	    }
	}
	addEdit(atomicEdits, {
	    name: "addHavingColumnReference",
	    description: "Add (missing) column reference to the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, addColumnReference(meta.having.columns), meta.having.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeHavingColumnReference",
	    description: "Remove (excess) column-reference from the having-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceHavingExpression(query, result, removeColumnReference, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setHavingColumnReferenceTable",
	    description: "Set (missing) table name on a column reference in the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, setColumnReferenceTable, meta.having.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetHavingColumnReferenceTable",
	    description: "Unset (excess) table name on a column reference in the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, unsetColumnReferenceTable, meta.having.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addHavingLiteral",
	    description: "Add (missing) literal to the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, addLiteral(meta.having.literals), meta.having.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeHavingLiteral",
	    description: "Remove (excess) literal from the having-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceHavingExpression(query, result, removeLiteral, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addHavingNot",
	    description: "Add (missing) NOT to the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, addNot, meta.having.notHeight, meta.having);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeHavingbyNot",
	    description: "Remove (excess) NOT from the having-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceHavingExpression(query, result, removeNot, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addHavingAggregationFunction",
	    description: "Add (missing) aggregation function to the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, addAggregationFunction(meta.having.aggregations), meta.having.aggregationHeight, meta.having);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeHavingAggregationFunction",
	    description: "Remove (excess) aggregation-function from the having-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceHavingExpression(query, result, removeAggregationFunction, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setHavingAggregationFunctionDistinct",
	    description: "Set (missing) distinct-declaration on an aggregation function in the having-clause",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, setAggregationFunctionDistinct, meta.having.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetHavingAggregationFunctionDistinct",
	    description: "Unset (excess) distinct-declaration on an aggregation function in the having-clause",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, unsetAggregationFunctionDistinct, meta.having.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addHavingBinaryExpression",
	    description: "Add (missing) binary expression to the having-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, addBaseBinaryExpression, meta.having.binaryExpressionHeight, meta.having);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeHavingBinaryExpression",
	    description: "Remove (excess) binary-expression from the having-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceHavingExpression(query, result, removeBinaryExpression, Infinity);
	    }
	});
	function replaceOrderbyExpression(query, result, multimap, recursionDepth, maxHeight = null) {
	    if (recursionDepth < 0) return;
	    for(let o = 0; o < query.orderbyLength; ++o){
	        const orderby = query.getOrderby(o);
	        const expressions = orderby.recursivelyReplaceExpression(multimap, recursionDepth, query, maxHeight);
	        for(let e = 0, n = expressions.length; e < n; ++e){
	            result.push(query.setOrderbyElement(o, orderby.setExpression(expressions[e])));
	        }
	    }
	}
	addEdit(atomicEdits, {
	    name: "addOrderbyElement",
	    description: "Add (missing) element in order-by-clause",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        if (query.orderbyLength >= meta.orderby.length) return;
	        for(let o = 0; o <= query.orderbyLength; ++o){
	            result.push(query.setOrderbyElement(o, OrderBy.baseOrderBy, false));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyElement",
	    description: "Remove (excess) element in order-by-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let o = 0; o < query.orderbyLength; ++o){
	            result.push(query.setOrderbyElement(o));
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "setOrderbyDescending",
	    description: "Set order of order-by-element from ascending to descending",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let o = 0; o < query.orderbyLength; ++o){
	            const orderby = query.getOrderby(o);
	            if (orderby.descending == false) {
	                result.push(query.setOrderbyElement(o, orderby.setDescending(true)));
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetOrderbyDescending",
	    description: "Set order of order-by-element from descending to ascending",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        for(let o = 0; o < query.orderbyLength; ++o){
	            const orderby = query.getOrderby(o);
	            if (orderby.descending == true) {
	                result.push(query.setOrderbyElement(o, orderby.setDescending(false)));
	            }
	        }
	    }
	});
	addEdit(atomicEdits, {
	    name: "addOrderbyColumnReference",
	    description: "Add (missing) column reference to a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, addColumnReference(meta.orderby.columns), meta.orderby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyColumnReference",
	    description: "Remove (excess) column-reference from a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceOrderbyExpression(query, result, removeColumnReference, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setOrderbyColumnReferenceTable",
	    description: "Set (missing) table name on a column reference in a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, setColumnReferenceTable, meta.orderby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetOrderbyColumnReferenceTable",
	    description: "Unset (excess) table name on a column reference in a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, unsetColumnReferenceTable, meta.orderby.columnReferenceHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addOrderbyLiteral",
	    description: "Add (missing) literal to a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, addLiteral(meta.orderby.literals), meta.orderby.literalHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyLiteral",
	    description: "Remove (excess) literal from a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceOrderbyExpression(query, result, removeLiteral, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addOrderbyNot",
	    description: "Add (missing) NOT to a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, addNot, meta.orderby.notHeight, meta.orderby);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyNot",
	    description: "Remove (excess) NOT from a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceOrderbyExpression(query, result, removeNot, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addOrderbyAggregationFunction",
	    description: "Add (missing) aggregation function to a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, addAggregationFunction(meta.orderby.aggregations), meta.orderby.aggregationHeight, meta.orderby);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyAggregationFunction",
	    description: "Remove (excess) aggregation-function from a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceOrderbyExpression(query, result, removeAggregationFunction, Infinity);
	    }
	});
	addEdit(atomicEdits, {
	    name: "setOrderbyAggregationFunctionDistinct",
	    description: "Set (missing) distinct-declaration on an aggregation function " + "in an order-by-element expression",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, setAggregationFunctionDistinct, meta.orderby.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "unsetOrderbyAggregationFunctionDistinct",
	    description: "Unset (excess) distinct-declaration on an aggregation function " + "in an order-by-element expression",
	    cost: 2,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, unsetAggregationFunctionDistinct, meta.orderby.aggregationHeight);
	    }
	});
	addEdit(atomicEdits, {
	    name: "addOrderbyBinaryExpression",
	    description: "Add (missing) binary expression to a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, addBaseBinaryExpression, meta.orderby.binaryExpressionHeight, meta.orderby);
	    }
	});
	addEdit(atomicEdits, {
	    name: "removeOrderbyBinaryExpression",
	    description: "Remove (excess) binary-expression from a order-by-element expression",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        replaceOrderbyExpression(query, result, removeBinaryExpression, Infinity);
	    }
	});

	const horizontalEdits = new Map();
	function changeAsteriskTable(x, context) {
	    if (!Asterisk.isAsterisk(x) || x.table == null) return [];
	    const res = [];
	    for(let f = 0; f < context.query.fromLength; ++f){
	        const fe = context.query.getFrom(f);
	        if (fe.alias != x.table) {
	            res.push(x.setTable(fe.alias));
	        }
	    }
	    return res;
	}
	function changeColumnReferenceColumn(columnReferences, schema) {
	    return (x, context)=>{
	        if (!ColumnReference.isColumnReference(x)) return [];
	        if (!x.table) return columnReferences;
	        let from = null;
	        for(let f = 0; f < context.query.fromLength; ++f){
	            const fe = context.query.getFrom(f);
	            if (fe.alias == x.table) {
	                from = fe;
	                break;
	            }
	        }
	        if (from == null) return [];
	        const res = [];
	        for (let c of columnReferences){
	            if (schema.get(from.table).has(c.column)) {
	                res.push(x.setColumn(c.column));
	            }
	        }
	        return res;
	    };
	}
	function changeColumnReferenceTable(x, context) {
	    if (!ColumnReference.isColumnReference(x) || !x.table) return [];
	    const res = [];
	    for(let f = 0; f < context.query.fromLength; ++f){
	        const fe = context.query.getFrom(f);
	        if (fe.alias != x.table) {
	            res.push(x.setTable(fe.alias));
	        }
	    }
	    return res;
	}
	function changeLiteralValue(literals) {
	    return (x)=>Literal.isLiteral(x) ? literals : [];
	}
	function changeAggregationFunctionAggregation(aggregations) {
	    return (x)=>{
	        if (!AggregationFunction.isAggregationFunction(x)) return [];
	        const res = [];
	        for(let a = 0, n = aggregations.length; a < n; ++a){
	            const aggregation = aggregations[a].aggregation;
	            if (aggregation != x.aggregation) {
	                res.push(x.setAggregation(aggregation));
	            }
	        }
	        return res;
	    };
	}
	function changeBaseBinaryExpressionOperator(x) {
	    if (!BinaryExpression.isBinaryExpression(x)) return [];
	    const res = [];
	    for(let b = 0, n = BinaryExpression.baseBinaryExpressions.length; b < n; ++b){
	        const operator = BinaryExpression.baseBinaryExpressions[b].operator;
	        if (operator != x.operator) {
	            res.push(x.setOperator(operator));
	        }
	    }
	    return res;
	}
	function swapCommutativeArguments(x, context) {
	    if (!BinaryExpression.isBinaryExpression(x) || !BinaryExpression.isCommutative(x.operator) || x.left == x.right || x.left && x.left.equals(x.right, context.query, context.query)) {
	        return [];
	    }
	    return [
	        x.setLeft(x.right).setRight(x.left)
	    ];
	}
	function swapAssociativeNesting(x, context) {
	    if (!BinaryExpression.isBinaryExpression(x) || !BinaryExpression.isAssiciative(x.operator)) {
	        return [];
	    }
	    const res = [];
	    if (BinaryExpression.isBinaryExpression(x.left) && x.left.operator == x.operator && (x.right == null || context.maxHeight.minDiff(x.right.height) >= context.stack.length + 2)) {
	        res.push(x.left.setRight(x.setLeft(x.left.right)));
	    }
	    if (BinaryExpression.isBinaryExpression(x.right) && x.right.operator == x.operator && (x.left == null || context.maxHeight.minDiff(x.left.height) >= context.stack.length + 2)) {
	        res.push(x.right.setLeft(x.setRight(x.right.left)));
	    }
	    return res;
	}
	function mirrorInequation(x, context) {
	    if (!BinaryExpression.isBinaryExpression(x) || !(x.operator == OperatorType.LESS || x.operator == OperatorType.GREATER) || x.left == x.right || x.left && x.left.equals(x.right, context.query, context.query)) {
	        return [];
	    }
	    return [
	        x.setLeft(x.right).setRight(x.left).setOperator(x.operator == OperatorType.LESS ? OperatorType.GREATER : OperatorType.LESS)
	    ];
	}
	addEdit(horizontalEdits, {
	    name: "swapSelectElements",
	    description: "Swap elements in the select-clause",
	    cost: 1,
	    perform: (query, _schema, _meta, result)=>{
	        if (query.selectLength < 2) return;
	        const select = query.copySelect();
	        for(let s = 1, n = select.length; s < n; ++s){
	            const select1 = select[s - 1], select2 = select[s];
	            if (select1 == select2 || select1 && select1.equals(select2, query, query)) continue;
	            select[s] = select1;
	            select[s - 1] = select2;
	            result.push(query.setSelect(select));
	            select[s - 1] = select1;
	            select[s] = select2;
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectAsteriskTable",
	    description: "Change (incorrect) table name on an asterisk in a select-element expression",
	    cost: atomicEdits.get("setSelectAsteriskTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeAsteriskTable, meta.select.length, 1);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in a select-element expression",
	    cost: atomicEdits.get("addSelectColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeColumnReferenceColumn(meta.select.columns, schema), meta.select.length, meta.select.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in a select-element expression",
	    cost: atomicEdits.get("setSelectColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeColumnReferenceTable, meta.select.length, meta.select.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectLiteralValue",
	    description: "Change (incorrect) literal value in a select-element expression",
	    cost: atomicEdits.get("addSelectLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeLiteralValue(meta.select.literals), meta.select.length, meta.select.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectAggregationFunctionAggregation",
	    description: "Change (incorrect) aggregation-function aggregation in a select-element expression",
	    cost: atomicEdits.get("addSelectAggregationFunction").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeAggregationFunctionAggregation(meta.select.aggregations), meta.select.length, meta.select.aggregationHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in a select-element expression",
	    cost: atomicEdits.get("addSelectBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, changeBaseBinaryExpressionOperator, meta.select.length, meta.select.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapSelectBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, swapCommutativeArguments, meta.select.length, meta.select.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapSelectBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, swapAssociativeNesting, meta.select.length, meta.select.binaryExpressionHeight, meta.select);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorSelectBinaryExpressionInequation",
	    description: "Mirror an inequation in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, mirrorInequation, meta.select.length, meta.select.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeSelectAlias",
	    description: "Change (incorrect) explicit alias on a select-element",
	    cost: atomicEdits.get("setSelectAlias").cost,
	    perform: (query, _schema, meta, result)=>{
	        if (!meta.select.as.length) return;
	        for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	            const se = query.getSelect(s);
	            if (se.as == null) continue;
	            for(let a = 0, n = meta.select.as.length; a < n; ++a){
	                const as = meta.select.as[a];
	                if (as != se.as) {
	                    result.push(query.setSelectElement(s, se.setAs(as)));
	                }
	            }
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapFromElements",
	    description: "Swap elements in the from-clause",
	    cost: 0,
	    perform: (query, _schema, _meta, result)=>{
	        if (query.copyFrom().some((f)=>f.join != null) || query.copySelect().some((s)=>Asterisk.isAsterisk(s.expression))) return;
	        if (query.fromLength < 2) return;
	        const from = query.copyFrom();
	        for(let f = 1, n = from.length; f < n; ++f){
	            const from1 = from[f - 1], from2 = from[f];
	            if (from1 == from2 || from1 && from1.equals(from2, query, query) || from1.join != null || from2.join == JoinType.LEFT_OUTER || from2.join == JoinType.RIGHT_OUTER) {
	                continue;
	            }
	            from[f] = from2.join != null ? from1.setJoin(from2.join).setOn(from2.on) : from1;
	            from[f - 1] = from2.join != null ? from2.setJoin(null).setOn(null) : from2;
	            result.push(query.setFrom(from));
	            from[f - 1] = from1;
	            from[f] = from2;
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromJoinType",
	    description: "Change (incorrect) from-element join-type",
	    cost: atomicEdits.get("setTableJoinType").cost,
	    perform: (query, _schema, meta, result)=>{
	        if (!meta.from.join) return;
	        for(let f = 1; f < query.fromLength; ++f){
	            const from = query.getFrom(f);
	            if (from.join == null) continue;
	            for(let item in JoinType){
	                if (isNaN(Number(item))) {
	                    result.push(query.setFromElement(f, from.setJoin(JoinType[item])));
	                }
	            }
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in a from-element join-condition",
	    cost: atomicEdits.get("addFromColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceFromExpression(query, result, changeColumnReferenceColumn(meta.from.columns, schema), meta.from.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in a from-element join-condition",
	    cost: atomicEdits.get("setFromColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, changeColumnReferenceTable, meta.from.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromLiteralValue",
	    description: "Change (incorrect) literal value in a from-element join-condition",
	    cost: atomicEdits.get("addFromLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceFromExpression(query, result, changeLiteralValue(meta.from.literals), meta.from.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in a from-element join-condition",
	    cost: atomicEdits.get("addFromBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, changeBaseBinaryExpressionOperator, meta.from.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapFromBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, swapCommutativeArguments, meta.from.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapFromBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, swapAssociativeNesting, meta.from.binaryExpressionHeight, false, false, meta.from);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorFromBinaryExpressionInequation",
	    description: "Mirror an inequation in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, mirrorInequation, meta.from.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeFromAlias",
	    description: "Change (incorrect) explicit alias on a from-element",
	    cost: atomicEdits.get("setSelectAlias").cost,
	    perform: (query, schema, _meta, result)=>{
	        for(let f = 0; f < query.fromLength; ++f){
	            const fe = query.getFrom(f);
	            if (fe.as == null || !schema.has(fe.table)) continue;
	            let as = schema.get(fe.table).name.charAt(0);
	            let asNr = 0;
	            for(let exists = true; exists; asNr++){
	                exists = false;
	                for(let f2 = 0; f2 < query.fromLength; ++f2){
	                    if (query.getFrom(f2).as == as + asNr) {
	                        exists = true;
	                        break;
	                    }
	                }
	            }
	            result.push(query.setFromElement(f, fe.setAs(as + asNr)));
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeWhereColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in the where-clause",
	    cost: atomicEdits.get("addWhereColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceWhereExpression(query, result, changeColumnReferenceColumn(meta.where.columns, schema), meta.where.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeWhereColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in the where-clause",
	    cost: atomicEdits.get("setWhereColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, changeColumnReferenceTable, meta.where.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeWhereLiteralValue",
	    description: "Change (incorrect) literal value in the where-clause",
	    cost: atomicEdits.get("addWhereLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceWhereExpression(query, result, changeLiteralValue(meta.where.literals), meta.where.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeWhereBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in the where-clause",
	    cost: atomicEdits.get("addWhereBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, changeBaseBinaryExpressionOperator, meta.where.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapWhereBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, swapCommutativeArguments, meta.where.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapWhereBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, swapAssociativeNesting, meta.where.binaryExpressionHeight, meta.where);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorWhereBinaryExpressionInequation",
	    description: "Mirror an inequation in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, mirrorInequation, meta.where.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapGroupbyElements",
	    description: "Swap elements in the group-by-clause",
	    cost: 0,
	    perform: (query, _schema, _meta, result)=>{
	        if (query.groupbyLength < 2) return;
	        const groupby = query.copyGroupby();
	        for(let g = 1, n = groupby.length; g < n; ++g){
	            const g1 = groupby[g - 1], g2 = groupby[g];
	            if (g1 == g2 || g1 && g1.equals(g2, query, query)) continue;
	            groupby[g] = g1;
	            groupby[g - 1] = g2;
	            result.push(query.setGroupby(groupby));
	            groupby[g - 1] = g1;
	            groupby[g] = g2;
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeGroupbyColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in a group-by expression",
	    cost: atomicEdits.get("addGroupbyColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, changeColumnReferenceColumn(meta.groupby.columns, schema), meta.groupby.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeGroupbyColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in a group-by expression",
	    cost: atomicEdits.get("setGroupbyColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, changeColumnReferenceTable, meta.groupby.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeGroupbyLiteralValue",
	    description: "Change (incorrect) literal value in a group-by expression",
	    cost: atomicEdits.get("addGroupbyLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, changeLiteralValue(meta.groupby.literals), meta.groupby.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeGroupbyBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in a group-by expression",
	    cost: atomicEdits.get("addGroupbyBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, changeBaseBinaryExpressionOperator, meta.groupby.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapGroupbyBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, swapCommutativeArguments, meta.groupby.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapGroupbyBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, swapAssociativeNesting, meta.groupby.binaryExpressionHeight, meta.groupby);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorGroupbyBinaryExpressionInequation",
	    description: "Mirror an inequation in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, mirrorInequation, meta.groupby.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeHavingColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in the having-clause",
	    cost: atomicEdits.get("addHavingColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceHavingExpression(query, result, changeColumnReferenceColumn(meta.having.columns, schema), meta.having.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeHavingColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in the having-clause",
	    cost: atomicEdits.get("setHavingColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, changeColumnReferenceTable, meta.having.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeHavingLiteralValue",
	    description: "Change (incorrect) literal value in the having-clause",
	    cost: atomicEdits.get("addHavingLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceHavingExpression(query, result, changeLiteralValue(meta.having.literals), meta.having.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeHavingAggregationFunctionAggregation",
	    description: "Change (incorrect) aggregation-function aggregation in the having-clause",
	    cost: atomicEdits.get("addHavingAggregationFunction").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, changeAggregationFunctionAggregation(meta.having.aggregations), meta.having.aggregationHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeHavingBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in the having-clause",
	    cost: atomicEdits.get("addHavingBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, changeBaseBinaryExpressionOperator, meta.having.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapHavingBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, swapCommutativeArguments, meta.having.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapHavingBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, swapAssociativeNesting, meta.having.binaryExpressionHeight, meta.having);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorHavingBinaryExpressionInequation",
	    description: "Mirror an inequation in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, mirrorInequation, meta.having.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyElements",
	    description: "Change position of elements in the order-by-clause",
	    cost: atomicEdits.get("addOrderbyElement").cost,
	    perform: (query, _schema, _meta, result)=>{
	        if (query.orderbyLength < 2) return;
	        const orderby = query.copyOrderby();
	        for(let o = 1, n = orderby.length; o < n; ++o){
	            const o1 = orderby[o - 1], o2 = orderby[o];
	            if (o1 == o2 || o1 && o1.equals(o2, query, query)) continue;
	            orderby[o] = o1;
	            orderby[o - 1] = o2;
	            result.push(query.setOrderby(orderby));
	            orderby[o - 1] = o1;
	            orderby[o] = o2;
	        }
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyColumnReferenceColumn",
	    description: "Change (incorrect) column-reference column in a order-by expression",
	    cost: atomicEdits.get("addOrderbyColumnReference").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, changeColumnReferenceColumn(meta.orderby.columns, schema), meta.orderby.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyColumnReferenceTable",
	    description: "Change (incorrect) column-reference table in a order-by expression",
	    cost: atomicEdits.get("setOrderbyColumnReferenceTable").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, changeColumnReferenceTable, meta.orderby.columnReferenceHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyLiteralValue",
	    description: "Change (incorrect) literal value in a order-by expression",
	    cost: atomicEdits.get("addOrderbyLiteral").cost,
	    perform: (query, schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, changeLiteralValue(meta.orderby.literals), meta.orderby.literalHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyAggregationFunctionAggregation",
	    description: "Change (incorrect) aggregation-function aggregation in a order-by expression",
	    cost: atomicEdits.get("addOrderbyAggregationFunction").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, changeAggregationFunctionAggregation(meta.orderby.aggregations), meta.orderby.aggregationHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "changeOrderbyBinaryExpressionOperator",
	    description: "Change (incorrect) binary-expression operator in a order-by expression",
	    cost: atomicEdits.get("addOrderbyBinaryExpression").cost,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, changeBaseBinaryExpressionOperator, meta.orderby.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapOrderbyBinaryExpressionArguments",
	    description: "Swap arguments of commutative binary-expression in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, swapCommutativeArguments, meta.orderby.binaryExpressionHeight);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "swapOrderbyBinaryExpressionNesting",
	    description: "Swap nesting of associative binary-expression in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, swapAssociativeNesting, meta.orderby.binaryExpressionHeight, meta.orderby);
	    }
	});
	addEdit(horizontalEdits, {
	    name: "mirrorOrderbyBinaryExpressionInequation",
	    description: "Mirror an inequation in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, mirrorInequation, meta.orderby.binaryExpressionHeight);
	    }
	});

	const shortcutEdits = new Map();
	function isBoolean(x) {
	    return Not.isNot(x) || BinaryExpression.isBinaryExpression(x) && BinaryExpression.isBoolean(x.operator);
	}
	function applyTautologyLaw(x, context) {
	    const res = [];
	    if (isBoolean(x) && context.maxHeight.minDiff(x.height) >= context.stack.length + 1) {
	        res.push(new BinaryExpression(OperatorType.AND, x, x));
	        res.push(new BinaryExpression(OperatorType.OR, x, x));
	    }
	    if (BinaryExpression.isBinaryExpression(x) && (x.operator == OperatorType.AND || x.operator == OperatorType.OR) && isBoolean(x.left) && (x.left == x.right || x.left && x.left.equals(x.right, context.query, context.query))) {
	        res.push(x.left);
	    }
	    return res;
	}
	function applyDoubleNegationLaw(x, context) {
	    const res = [];
	    if (isBoolean(x) && context.maxHeight.minDiff(x.height) >= context.stack.length + 2) {
	        res.push(new Not(new Not(x)));
	    }
	    if (Not.isNot(x) && Not.isNot(x.argument) && isBoolean(x.argument.argument)) {
	        res.push(x.argument.argument);
	    }
	    return res;
	}
	function applyDistributiveLaw(x, context) {
	    if (!BinaryExpression.isBinaryExpression(x)) return [];
	    const res = [];
	    if (BinaryExpression.isBinaryExpression(x.left) && BinaryExpression.isDistributive(x.operator, x.left.operator) && (x.right == null || context.maxHeight.minDiff(x.right.height) >= context.stack.length + 2)) {
	        res.push(x.setOperator(x.left.operator).setLeft(new BinaryExpression(x.operator, x.left.left, x.right)).setRight(new BinaryExpression(x.operator, x.left.right, x.right)));
	    }
	    if (BinaryExpression.isBinaryExpression(x.right) && BinaryExpression.isDistributive(x.operator, x.right.operator) && (x.left == null || context.maxHeight.minDiff(x.left.height) >= context.stack.length + 2)) {
	        res.push(x.setOperator(x.right.operator).setLeft(new BinaryExpression(x.operator, x.left, x.right.left)).setRight(new BinaryExpression(x.operator, x.left, x.right.right)));
	    }
	    if (BinaryExpression.isBinaryExpression(x.left) && BinaryExpression.isBinaryExpression(x.right) && x.left.operator == x.right.operator && BinaryExpression.isDistributive(x.operator, x.left.operator)) {
	        if (x.left.left == x.right.left || x.left.left && x.left.left.equals(x.right.left, context.query, context.query)) {
	            res.push(x.setOperator(x.left.operator).setLeft(x.left.left).setRight(new BinaryExpression(x.operator, x.left.right, x.right.right)));
	        }
	        if (x.left.right === x.right.right || x.left.right && x.left.right.equals(x.right.right, context.query, context.query)) {
	            res.push(x.setOperator(x.left.operator).setLeft(new BinaryExpression(x.operator, x.left.left, x.right.left)).setRight(x.left.right));
	        }
	    }
	    return res;
	}
	function applyDeMorgan(x) {
	    const res = [];
	    if (Not.isNot(x) && BinaryExpression.isBinaryExpression(x.argument)) {
	        if (x.argument.operator == OperatorType.AND) {
	            res.push(x.argument.setOperator(OperatorType.OR).setLeft(new Not(x.argument.left)).setRight(new Not(x.argument.right)));
	        } else if (x.argument.operator == OperatorType.OR) {
	            res.push(x.argument.setOperator(OperatorType.AND).setLeft(new Not(x.argument.left)).setRight(new Not(x.argument.right)));
	        }
	    } else if (BinaryExpression.isBinaryExpression(x) && Not.isNot(x.left) && Not.isNot(x.right)) {
	        if (x.operator == OperatorType.AND) {
	            res.push(new Not(x.setOperator(OperatorType.OR).setLeft(x.left.argument).setRight(x.right.argument)));
	        } else if (x.operator == OperatorType.OR) {
	            res.push(new Not(x.setOperator(OperatorType.AND).setLeft(x.left.argument).setRight(x.right.argument)));
	        }
	    }
	    return res;
	}
	function applyAbsorptionLaw(x, context) {
	    if (!BinaryExpression.isBinaryExpression(x) || x.operator != OperatorType.AND && x.operator != OperatorType.OR) return [];
	    const res = [];
	    if ((x.left == null || isBoolean(x.left)) && BinaryExpression.isBinaryExpression(x.right) && x.right.operator == (x.operator == OperatorType.OR ? OperatorType.AND : OperatorType.OR) && (x.left == x.right.left || x.left && x.left.equals(x.right.left, context.query, context.query) || x.left == x.right.right || x.left && x.left.equals(x.right.right, context.query, context.query))) {
	        res.push(x.left);
	    }
	    if ((x.right == null || isBoolean(x.right)) && BinaryExpression.isBinaryExpression(x.left) && x.left.operator == (x.operator == OperatorType.OR ? OperatorType.AND : OperatorType.OR) && (x.right == x.left.left || x.right && x.right.equals(x.left.left, context.query, context.query) || x.right == x.left.right || x.right && x.right.equals(x.left.right, context.query, context.query))) {
	        res.push(x.right);
	    }
	    return res;
	}
	addEdit(shortcutEdits, {
	    name: "applySelectTautologyLaw",
	    description: "Apply tautology law in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, applyTautologyLaw, meta.select.length, meta.select.binaryExpressionHeight, meta.select);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applySelectDoubleNegationLaw",
	    description: "Apply double negation law in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, applyDoubleNegationLaw, meta.select.length, meta.select.notHeight, meta.select);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applySelectDistributiveLaw",
	    description: "Apply distibutive law in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, applyDistributiveLaw, meta.select.length, meta.select.binaryExpressionHeight, meta.select);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applySelectDeMorgan",
	    description: "Apply De Morgan's law in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, applyDeMorgan, meta.select.length, Math.max(meta.select.binaryExpressionHeight, meta.select.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applySelectAbsorptionLaw",
	    description: "Apply absorption law in a select-element expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceSelectExpression(query, result, applyAbsorptionLaw, meta.select.length, meta.select.binaryExpressionHeight);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyFromTautologyLaw",
	    description: "Apply tautology law in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, applyTautologyLaw, meta.from.binaryExpressionHeight, false, false, meta.from);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyFromDoubleNegationLaw",
	    description: "Apply double negation law in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, applyDoubleNegationLaw, meta.from.notHeight, false, false, meta.from);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyFromDistributiveLaw",
	    description: "Apply distibutive law in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, applyDistributiveLaw, meta.from.binaryExpressionHeight, false, false, meta.from);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyFromDeMorgan",
	    description: "Apply De Morgan's law in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, applyDeMorgan, Math.max(meta.from.binaryExpressionHeight, meta.from.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyFromAbsorptionLaw",
	    description: "Apply absorption law in a from-element join-condition",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceFromExpression(query, result, applyAbsorptionLaw, meta.from.binaryExpressionHeight);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyWhereTautologyLaw",
	    description: "Apply tautology law in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, applyTautologyLaw, meta.where.binaryExpressionHeight, meta.where);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyWhereDoubleNegationLaw",
	    description: "Apply double negation law in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, applyDoubleNegationLaw, meta.where.notHeight, meta.where);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyWhereDistributiveLaw",
	    description: "Apply distibutive law in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, applyDistributiveLaw, meta.where.binaryExpressionHeight, meta.where);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyWhereDeMorgan",
	    description: "Apply De Morgan's law in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, applyDeMorgan, Math.max(meta.where.binaryExpressionHeight, meta.where.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyWhereAbsorptionLaw",
	    description: "Apply absorption law in the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceWhereExpression(query, result, applyAbsorptionLaw, meta.where.binaryExpressionHeight);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyGroupbyTautologyLaw",
	    description: "Apply tautology law in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, applyTautologyLaw, meta.groupby.binaryExpressionHeight, meta.groupby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyGroupbyDoubleNegationLaw",
	    description: "Apply double negation law in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, applyDoubleNegationLaw, meta.groupby.notHeight, meta.groupby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyGroupbyDistributiveLaw",
	    description: "Apply distibutive law in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, applyDistributiveLaw, meta.groupby.binaryExpressionHeight, meta.groupby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyGroupbyDeMorgan",
	    description: "Apply De Morgan's law in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, applyDeMorgan, Math.max(meta.groupby.binaryExpressionHeight, meta.groupby.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyGroupbyAbsorptionLaw",
	    description: "Apply absorption law in a group-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceGroupbyExpression(query, result, applyAbsorptionLaw, meta.groupby.binaryExpressionHeight);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyHavingTautologyLaw",
	    description: "Apply tautology law in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, applyTautologyLaw, meta.having.binaryExpressionHeight, meta.having);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyHavingDoubleNegationLaw",
	    description: "Apply double negation law in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, applyDoubleNegationLaw, meta.having.notHeight - 1, meta.having);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyHavingDistributiveLaw",
	    description: "Apply distibutive law in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, applyDistributiveLaw, meta.having.binaryExpressionHeight, meta.having);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyHavingDeMorgan",
	    description: "Apply De Morgan's law in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, applyDeMorgan, Math.max(meta.having.binaryExpressionHeight, meta.having.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyHavingAbsorptionLaw",
	    description: "Apply absorption law in the having-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceHavingExpression(query, result, applyAbsorptionLaw, meta.having.binaryExpressionHeight);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyOrderbyTautologyLaw",
	    description: "Apply tautology law in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, applyTautologyLaw, meta.orderby.binaryExpressionHeight, meta.orderby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyOrderbyDoubleNegationLaw",
	    description: "Apply double negation law in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, applyDoubleNegationLaw, meta.orderby.notHeight, meta.orderby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyOrderbyDistributiveLaw",
	    description: "Apply distibutive law in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, applyDistributiveLaw, meta.orderby.binaryExpressionHeight, meta.orderby);
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyOrderbyDeMorgan",
	    description: "Apply De Morgan's law in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, applyDeMorgan, Math.max(meta.orderby.binaryExpressionHeight, meta.orderby.notHeight));
	    }
	});
	addEdit(shortcutEdits, {
	    name: "applyOrderbyAbsorptionLaw",
	    description: "Apply absorption law in a order-by expression",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        replaceOrderbyExpression(query, result, applyAbsorptionLaw, meta.orderby.binaryExpressionHeight);
	    }
	});
	function extractFirstLevelConjugate(removed) {
	    return (x, context)=>{
	        if (!BinaryExpression.isBinaryExpression(x) || x.operator != OperatorType.AND) return [];
	        for(let s = context.stack.length - 1; s >= 0; --s){
	            const se = context.stack[s];
	            if (!BinaryExpression.isBinaryExpression(se) || se.operator != OperatorType.AND) return [];
	        }
	        const res = [];
	        if (x.left != null) {
	            removed.push(x.left);
	            res.push(x.right);
	        }
	        if (x.right != null) {
	            removed.push(x.right);
	            res.push(x.left);
	        }
	        return res;
	    };
	}
	addEdit(shortcutEdits, {
	    name: "moveInnerJoinConditionToWhere",
	    description: "Move the join-condition of an INNER JOIN to the where-clause",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        if (meta.where.binaryExpressionHeight < 0 && meta.where.columnReferenceHeight < 0 && meta.where.literalHeight < 0 || query.where && meta.where.minDiff(query.where.height) < 1) return;
	        for(let f = 1; f < query.fromLength; ++f){
	            const fe = query.getFrom(f);
	            if (fe.on == null || fe.join != JoinType.INNER) continue;
	            const removed = [];
	            const expressions = fe.recursivelyReplaceOn(extractFirstLevelConjugate(removed), Infinity, query);
	            removed.push(fe.on);
	            expressions.push(null);
	            for(let e = 0, n = expressions.length; e < n; ++e){
	                if (removed[e] && meta.where.minDiff(removed[e].height) < (query.where == null ? 0 : 1)) {
	                    continue;
	                }
	                result.push(query.setFromElement(f, fe.setJoin(expressions[e] == null ? null : fe.join).setOn(expressions[e])).setWhere(query.where == null ? removed[e] : new BinaryExpression(OperatorType.AND, removed[e], query.where)));
	            }
	        }
	    }
	});
	addEdit(shortcutEdits, {
	    name: "moveWhereToInnerJoinCondition",
	    description: "Move expression from the where-clause to the join-condition of an INNER JOIN",
	    cost: 0,
	    perform: (query, _schema, meta, result)=>{
	        if (query.where == null || meta.from.binaryExpressionHeight < 0 && meta.from.columnReferenceHeight < 0 && meta.from.literalHeight < 0) return;
	        const removed = [];
	        const expressions = query.recursivelyReplaceWhere(extractFirstLevelConjugate(removed), meta.where.binaryExpressionHeight);
	        removed.push(query.where);
	        expressions.push(null);
	        for(let f = 1; f < query.fromLength; ++f){
	            const fe = query.getFrom(f);
	            if (fe.join != null && fe.join != JoinType.INNER || fe.on && meta.from.minDiff(fe.on.height) < 1) continue;
	            for(let e = 0, n = expressions.length; e < n; ++e){
	                if (removed[e] && meta.from.minDiff(removed[e].height) < (fe.on == null ? 0 : 1)) {
	                    continue;
	                }
	                result.push(query.setWhere(expressions[e]).setFromElement(f, fe.setJoin(JoinType.INNER).setOn(fe.on == null ? removed[e] : new BinaryExpression(OperatorType.AND, removed[e], fe.on))));
	            }
	        }
	    }
	});
	addEdit(shortcutEdits, {
	    name: "expandAsterisk",
	    description: "Replace an asterisk with the expressions it represents",
	    cost: 0,
	    perform: (query, schema, meta, result)=>{
	        if (query.groupbyLength > 0) {
	            for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	                const se = query.getSelect(s);
	                if (!Asterisk.isAsterisk(se.expression) || se.expression.table != null) continue;
	                let groups = [];
	                for(let g = 0; g < query.groupbyLength; ++g){
	                    groups.push(new SelectElement(query.getGroupby(g)));
	                }
	                let select = query.copySelect();
	                select.splice(s, 1, ...groups);
	                result.push(query.setSelect(select));
	            }
	        } else {
	            for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	                const se = query.getSelect(s);
	                if (!Asterisk.isAsterisk(se.expression)) continue;
	                let columns = [];
	                if (se.expression.table == null) {
	                    if (query.fromLength <= 0) continue;
	                    for(let f = 0; f < query.fromLength; ++f){
	                        let fe = query.getFrom(f);
	                        let table = fe.table;
	                        for (let [column] of schema.get(table)){
	                            let tableAliasRequired = false;
	                            for (let [otherTable] of schema){
	                                if (otherTable == table) continue;
	                                if (schema.get(otherTable).has(column)) {
	                                    tableAliasRequired = true;
	                                    break;
	                                }
	                            }
	                            columns.push(new SelectElement(new ColumnReference(column, tableAliasRequired ? fe.alias : null)));
	                        }
	                    }
	                } else {
	                    let t = se.expression.table;
	                    for(let f = 0; f < query.fromLength; ++f){
	                        const fe = query.getFrom(f);
	                        if (fe.alias == t) {
	                            t = fe.table;
	                            break;
	                        }
	                    }
	                    const table = schema.get(t);
	                    if (!table) continue;
	                    for (let [column] of table){
	                        let tableAliasRequired = false;
	                        for (let [otherTable] of schema){
	                            if (otherTable == t) continue;
	                            if (schema.get(otherTable).has(column)) {
	                                tableAliasRequired = true;
	                                break;
	                            }
	                        }
	                        columns.push(new SelectElement(new ColumnReference(column, tableAliasRequired ? se.expression.table : null)));
	                    }
	                }
	                let select = query.copySelect();
	                select.splice(s, 1, ...columns);
	                result.push(query.setSelect(select));
	            }
	        }
	    }
	});
	addEdit(shortcutEdits, {
	    name: "collapseAsterisk",
	    description: "Replace a number of expressions with an asterisk representing them",
	    cost: 0,
	    perform: (query, schema, meta, result)=>{
	        if (!meta.select.asterisk) return;
	        if (query.groupbyLength > 0) ; else if (query.fromLength > 0) {
	            for(let s = 0; s < query.selectLength && s < meta.select.length; ++s){
	                let replaceAll = true;
	                let sAll = s;
	                for(let f = 0; f < query.fromLength; ++f){
	                    const fe = query.getFrom(f);
	                    if (!schema.has(fe.table) || schema.get(fe.table).size > query.selectLength - s) {
	                        replaceAll = false;
	                        continue;
	                    }
	                    let replaceOne = true;
	                    let sOne = s;
	                    for (let [column] of schema.get(fe.table)){
	                        if (replaceAll && sAll < query.selectLength) {
	                            const se = query.getSelect(sAll);
	                            if (!ColumnReference.isColumnReference(se.expression) || se.expression.column != column || se.expression.table != null && se.expression.table != fe.alias) {
	                                replaceAll = false;
	                            }
	                            ++sAll;
	                            if (sAll > query.selectLength) replaceAll = false;
	                        }
	                        if (replaceOne && sOne < query.selectLength) {
	                            const se = query.getSelect(sOne);
	                            if (!ColumnReference.isColumnReference(se.expression) || se.expression.column != column || se.expression.table != null && se.expression.table != fe.alias) {
	                                replaceOne = false;
	                            }
	                            ++sOne;
	                            if (sOne > query.selectLength) replaceOne = false;
	                        }
	                        if (!(replaceAll || replaceOne)) break;
	                    }
	                    if (replaceOne && sOne > s) {
	                        let select = query.copySelect();
	                        select.splice(s, sOne - s, new SelectElement(new Asterisk(fe.alias)));
	                        result.push(query.setSelect(select));
	                    }
	                }
	                if (replaceAll && sAll > s) {
	                    let select = query.copySelect();
	                    select.splice(s, sAll - s, new SelectElement(Asterisk.baseAsterisk));
	                    result.push(query.setSelect(select));
	                }
	            }
	        }
	    }
	});

	function copyEntries(from, to) {
	    for (let [key, value] of from)to.set(key, Object.assign({}, value));
	}
	function createDefaultConfig() {
	    let defaultConfig = new Map();
	    copyEntries(atomicEdits, defaultConfig);
	    copyEntries(horizontalEdits, defaultConfig);
	    copyEntries(shortcutEdits, defaultConfig);
	    return defaultConfig;
	}

	function expression(x) {
	    if (!x) return null;
	    if (x.type === 'column_ref' && !x.collate) return x.column === '*' ? new Asterisk(x.table) : new ColumnReference(x.column, x.table);
	    if (x.type === 'number') return new Literal(Number(x.value));
	    if (['string', 'single_quote_string'].includes(x.type)) return new Literal(x.value);
	    if (x.type === 'star') return Asterisk.baseAsterisk;
	    if (x.type === 'binary_expr' && ['=', 'AND', 'OR', '<', '>'].includes(x.operator)) {
	        const op = {'=': OperatorType.EQUALS, AND: OperatorType.AND, OR: OperatorType.OR, '<': OperatorType.LESS, '>': OperatorType.GREATER}[x.operator];
	        return new BinaryExpression(op, expression(x.left), expression(x.right));
	    }
	    if (x.type === 'unary_expr' && x.operator === 'NOT') return new Not(expression(x.expr));
	    if (x.type === 'function' && x.name?.name?.[0]?.value === 'NOT' && x.args?.value?.length === 1) return new Not(expression(x.args.value[0]));
	    if (x.type === 'aggr_func' && !x.over && Object.hasOwn(AggregationType, x.name)) return new AggregationFunction(AggregationType[x.name], Boolean(x.args.distinct), x.name === 'COUNT' && x.args.expr?.type === 'star' ? null : expression(x.args.expr));
	    throw new Unsupported('original-expression', 'This expression is outside the original Graph-QSS edit model.');
	}
	function originalQuery(sql, allowEmpty = false) {
	    const tokens = lex(sql);
	    if (!tokens.length && allowEmpty) return new Query();
	    let ast;
	    try { ast = parseAst(parserSql(tokens)); } catch { throw new Unsupported('original-syntax', 'The SQL cannot be parsed by the original Graph-QSS adapter.'); }
	    if (Array.isArray(ast)) { if (ast.length !== 1) throw new Unsupported('original-script', 'Original Graph-QSS supports one SELECT only.'); ast = ast[0]; }
	    if (!ast || ast.type !== 'select' || ast.with || ast.options || ast.limit || ast._next || ast.set_op || ast.for_update) throw new Unsupported('original-statement', 'Original Graph-QSS supports a restricted single SELECT only.');
	    const from = (ast.from || []).map(f => {
	        const joins = {'INNER JOIN': JoinType.INNER, 'LEFT JOIN': JoinType.LEFT_OUTER, 'RIGHT JOIN': JoinType.RIGHT_OUTER, 'FULL JOIN': JoinType.FULL_OUTER};
	        if (!f.table || f.db || f.expr || f.using || f.join && !Object.hasOwn(joins, f.join)) throw new Unsupported('original-from', 'The FROM clause is outside the original edit model.');
	        return new FromElement(f.table, f.join ? joins[f.join] : null, expression(f.on), f.as);
	    });
	    return new Query(ast.distinct?.type === 'DISTINCT' || ast.distinct === 'DISTINCT',
	        (ast.columns === '*' ? [{expr: {type: 'star'}}] : ast.columns || []).map(c => new SelectElement(expression(c.expr), c.as)),
	        from, expression(ast.where), (ast.groupby?.columns || ast.groupby || []).map(expression), expression(ast.having),
	        (ast.orderby || []).map(o => new OrderBy(o.type === 'DESC', expression(o.expr))));
	}
	function originalSchema(reference, supplied) {
	    const tables = schemaTables(supplied);
	    if (!tables.size) return Schema.deduceSchema(reference);
	    const schema = new Schema();
	    for (const [name, columns] of tables) schema.set(name, Object.assign(new Map([...columns.keys()].map(name => [name, {name}])), {name}));
	    return schema;
	}

	class Heap {
	    values = [];
	    push(item) { const a = this.values; a.push(item); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].priority <= item.priority) break; a[i] = a[p]; i = p; } a[i] = item; }
	    pop() { const a = this.values, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1].priority < a[c].priority) ++c; if (a[c].priority >= last.priority) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
	    get length() { return this.values.length; }
	}

	/** Isolated lazy uniform-cost search. No timeout, no cost-gap scan, no global cancel. */
	function originalConfig(costs) {
	    const config = createDefaultConfig();
	    for (const [name, cost] of Object.entries(costs || {})) {
	        if (!config.has(name)) throw new Unsupported('original-edit', 'Unknown original edit configuration.');
	        config.get(name).cost = cost;
	    }
	    const edits = [...config.values()].sort((a, b) => a.cost - b.cost);
	    if (!edits.length || edits.some(e => !Number.isSafeInteger(e.cost) || e.cost < 0)) throw new Unsupported('invalid-costs', 'Edit costs must be finite nonnegative safe integers.');
	    return {config, edits};
	}
	async function originalDistance(reference, answer, schema, context, {cutoff = Infinity, costs} = {}) {
	    const {config, edits} = originalConfig(costs);
	    if (reference.equals(answer)) return {distance: 0, edits: [], visited: 1, capped: false};
	    const meta = new MetaInfo(reference, schema), visited = new Map(), queue = new Heap();
	    // Upstream FROM hashes omit table names: all n! table permutations otherwise
	    // collide. Include ordered table identities, preserving alias-insensitive equality.
	    const bucketKey = query => JSON.stringify([query.hash, query.copyFrom().map(f => f.table)]);
	    const remember = node => { const key = bucketKey(node.query); if (!visited.has(key)) visited.set(key, []); visited.get(key).push(node); };
	    const enqueue = (node, priority) => {
	        if (!Number.isSafeInteger(priority)) throw new Unsupported('distance-overflow', 'The edit distance exceeds exact integer precision.');
	        queue.push({node, priority});
	    };
	    const initial = {query: answer, distance: 0, previous: null, step: null, nextEdit: 0};
	    remember(initial); enqueue(initial, edits[0].cost);
	    while (queue.length) {
	        const {node, priority} = queue.pop();
	        context.frontier = queue.length + 1; context.lowerBound = priority;
	        await context.tick();
	        if (priority >= cutoff) return {distance: cutoff, edits: [], visited: context.visited, capped: true};
	        const edit = edits[node.nextEdit], neighbors = [];
	        edit.perform(node.query, schema, meta, neighbors);
	        for (const query of neighbors) {
	            await context.tick();
	            if ((visited.get(bucketKey(query)) || []).some(n => query.equals(n.query))) continue;
	            const next = {query, distance: priority, previous: node, step: edit.name, nextEdit: 0};
	            if (reference.equals(query)) {
	                const path = [];
	                for (let n = next; n.previous; n = n.previous) path.push({type: 'original-edit', name: n.step, cost: config.get(n.step).cost});
	                return {distance: priority, edits: path.reverse(), visited: context.visited, capped: false};
	            }
	            remember(next); enqueue(next, priority + edits[0].cost);
	        }
	        if (++node.nextEdit < edits.length) enqueue(node, node.distance + edits[node.nextEdit].cost);
	    }
	    throw new Unsupported('original-unreachable', 'The original edit graph could not reach the model query.');
	}

	const VERSION = '2.1.0';
	const GRAPH_ENGINE = 'graph-qss-sqlite-v2';
	const ORIGINAL_ENGINE = 'graph-qss-original-v1';
	const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
	class Cancelled extends Error {}
	function context(onProgress, signal) {
	    return {
	        phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0, work: 0,
	        async tick() {
	            if (signal?.aborted) throw new Cancelled();
	            if (++this.work % 256 !== 0) return;
	            onProgress?.({phase: this.phase, visited: this.visited, frontier: this.frontier, lowerBound: this.lowerBound});
	            await yieldTask();
	            if (signal?.aborted) throw new Cancelled();
	        }
	    };
	}
	const round = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
	const limitations = [
	    'Graph-based QSS following sections 4.2–4.7 of Köberlein et al.; the SQLite AST and edit catalogue extend the SELECT prototype.',
	    'The shortest directed SQL-edit path is exact within the declared fixed edit catalogue, finite symbol domain and AST bounds; it does not decide complete SQL equivalence.',
	    'A positive distance can reflect an equivalence absent from the current edit catalogue.',
	    'Edit costs and the constant linear scale are provisional and have not been calibrated against independently human-graded student submissions.',
	    'Browser-computed shadow results are untrusted evidence, not authoritative grades.'
	];

	/** SQL analysis, neighbour generation and shortest-path search run only locally. */
	async function evaluate(request, onProgress, {signal} = {}) {
	    const engine = request?.engine || GRAPH_ENGINE;
	    const maxPoints = Number(request?.maxPoints ?? 1);
	    const scale = Number(request?.scale ?? request?.pointsPerEdit ?? (maxPoints>0?maxPoints/5:1));
	    const base = {engine, version: VERSION, modelVersion: VERSION, maxPoints, scale, distance: null, points: null,
	        edits: [], exactWithinModel: false, provisionalRubric: true, rubric: 'paper-linear-v2',
	        formula: 'max(maxPoints - distance * scale, 0)', referenceDistance: null, normalizationDistance: null};
	    const job = context(onProgress, signal);
	    try {
	        if (![GRAPH_ENGINE, ORIGINAL_ENGINE].includes(engine)) throw new Unsupported('unknown-engine', 'Unknown QSS model; the former syntax-tree distance has been removed.');
	        if (!Number.isFinite(maxPoints) || maxPoints < 0) throw new Unsupported('invalid-maximum', 'Maximum points must be finite and nonnegative.');
	        if (!Number.isFinite(scale) || scale <= 0) throw new Unsupported('invalid-scale', 'The constant linear grading scale must be positive and finite.');
	        if (typeof request.reference !== 'string' || typeof request.answer !== 'string') throw new Unsupported('input-type', 'Reference and answer SQL must be strings.');
	        if (signal?.aborted) throw new Cancelled();
	        onProgress?.({phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0});
	        await yieldTask();
	        // Runtime errors in student B or the independent control C do not reject
	        // a representable SQL AST: paper section4.3.2 explicitly permits it.
	        let result, validation;
	        const cutoff = request.exactDistance === true ? Infinity : maxPoints / scale;
	        if (engine === GRAPH_ENGINE) {
	            const reference = parseGraphSql(request.reference, {schema: request.schema});
	            const answer = parseGraphSql(request.answer, {schema: request.schema, allowEmpty: true});
	            validation = {reference: reference.validation, answer: answer.validation};
	            let requirements=questionRequirements(request.questionText);
	            if(requirements.freeDiagnostics){
	                const shapeVerified=request.referenceExecutionValid===true&&request.answerExecutionValid===true
	                    &&Number.isSafeInteger(request.referenceRows)&&request.referenceRows>0&&request.answerRows===request.referenceRows;
	                requirements={...requirements,freeDiagnostics:shapeVerified,freeLabels:shapeVerified?requirements.freeLabels:[]};
	            }
	            const graph = createEditGraph(reference.root, answer.root, request.schema, request.costs, requirements);
	            base.requirements=requirements;
	            job.phase = 'sql-edit-graph';
	            result = await shortestSqlEditPath(reference.root, answer.root, graph, job,
	                {cutoff: stableKey(reference.root) === stableKey(answer.root) ? Infinity : cutoff,
	                    useHeuristic: request.useHeuristic !== false});
	            if (!result.capped) {
	                let replay = answer.root;
	                for (const edit of result.edits) replay = replayOperation(replay, edit.operation);
	                if (stableKey(replay) !== stableKey(reference.root)) throw new Error('The SQL-edit trace does not replay to the reference AST.');
	            }
	        } else {
	            const reference = originalQuery(request.reference), answer = originalQuery(request.answer, true);
	            const schema = originalSchema(reference, request.schema);
	            try { reference.validateSemantics(schema); }
	            catch { throw new Unsupported('original-semantics', 'The reference exceeds the original SELECT prototype semantic model.'); }
	            originalConfig(request.costs);
	            job.phase = 'original-graph';
	            result = await originalDistance(reference, answer, schema, job, {cutoff, costs: request.costs});
	            validation = {reference: 'original-ast', answer: 'original-ast'};
	        }
	        if (signal?.aborted) throw new Cancelled();
	        const points = Math.min(maxPoints,round(Math.max(maxPoints - result.distance * scale, 0)));
	        const costSum = result.edits.reduce((sum, edit) => sum + edit.cost, 0);
	        if (!result.capped && Math.abs(costSum - result.distance) > 1e-8) throw new Error('The returned path cost does not equal its distance.');
	        return {...base, status: result.capped ? 'score-zero-certified' : 'exact',
	            distance: result.capped ? null : result.distance, lowerBound: result.distance,
	            points, edits: result.edits, exactWithinModel: !result.capped,
	            scoreCertifiedWithinModel: true, visited: result.visited,
	            search: result.search || 'exact-lazy-uniform-cost', heuristic: result.heuristic || 'zero',
	            limits: result.limits, validation, traceVerified: engine === GRAPH_ENGINE && !result.capped,
	            limitations: engine === GRAPH_ENGINE ? limitations : [...limitations,
	                'Explicit original SELECT prototype model; its restricted SQL support is unchanged.']};
	    } catch (error) {
	        if (error instanceof Cancelled || signal?.aborted) return {...base, status: 'cancelled', limitations: ['Manually cancelled; no score is certified.']};
	        if (error instanceof Unsupported) return {...base, status: 'unsupported', code: error.code, message: error.message,
	            limitations: ['This input is not representable by the SQL AST adapter; no syntax/string distance or zero grade was substituted.']};
	        return {...base, status: 'error', code: 'engine-error', message: error instanceof Error ? error.message : 'Unexpected QSS engine error.',
	            limitations: ['The graph calculation failed; no score is certified.']};
	    }
	}

	exports.GRAPH_ENGINE = GRAPH_ENGINE;
	exports.ORIGINAL_ENGINE = ORIGINAL_ENGINE;
	exports.VERSION = VERSION;
	exports.evaluate = evaluate;

	return exports;

})({});
