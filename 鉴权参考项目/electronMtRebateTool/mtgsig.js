function N(e, a) {
    return e(a = {
        exports: {}
    }, a['exports']),
        a['exports']
}

Je = N(function (e) {
    function a(e, a, t) {
        if (4 !== a.length) throw new c.exception.invalid("11");
        var n = e.g[t],
            f = a[0] ^ n[0],
            r = a[t ? 3 : 1] ^ n[1],
            d = a[2] ^ n[2];
        a = a[t ? 1 : 3] ^ n[3];
        var i,
            o,
            b = n.length / 4 - 2,
            s = 4,
            u = [0, 0, 0, 0];
        e = (i = e.a[t])[0];
        var p = i[1],
            h = i[2],
            l = i[3],
            g = i[4];
        for (o = 0; o < b; o++) {
            i = e[f >>> 24] ^ p[r >> 16 & 255] ^ h[d >> 8 & 255] ^ l[255 & a] ^ n[s];
            var y = e[r >>> 24] ^ p[d >> 16 & 255] ^ h[a >> 8 & 255] ^ l[255 & f] ^ n[s + 1],
                v = e[d >>> 24] ^ p[a >> 16 & 255] ^ h[f >> 8 & 255] ^ l[255 & r] ^ n[s + 2];
            a = e[a >>> 24] ^ p[f >> 16 & 255] ^ h[r >> 8 & 255] ^ l[255 & d] ^ n[s + 3], s += 4, f = i, r = y, d = v;
        }
        for (o = 0; 4 > o; o++) u[t ? 3 & -o : o] = g[f >>> 24] << 24 ^ g[r >> 16 & 255] << 16 ^ g[d >> 8 & 255] << 8 ^ g[255 & a] ^ n[s++], i = f, f = r, r = d, d = a, a = i;
        return u;
    }

    var c = {
        cipher: {},
        hash: {},
        keyexchange: {},
        mode: {},
        misc: {},
        codec: {},
        exception: {
            corrupt: function (e) {
                this.toString = function () {
                    return "CORRUPT: " + this.message;
                }, this.message = e;
            },
            invalid: function (e) {
                this.toString = function () {
                    return "INVALID: " + this.message;
                }, this.message = e;
            },
            bug: function (e) {
                this.toString = function () {
                    return "BUG: " + this.message;
                }, this.message = e;
            },
            notReady: function (e) {
                this.toString = function () {
                    return "NOT READY: " + this.message;
                }, this.message = e;
            }
        }
    };
    c.cipher.aes = function (e) {
        if (!this.a[0][0][0]) {
            var a,
                t,
                n,
                f,
                r = this.a[0],
                d = this.a[1],
                i = r[4],
                o = d[4],
                b = [],
                s = [];
            for (a = 0; 256 > a; a++) s[(b[a] = a << 1 ^ 283 * (a >> 7)) ^ a] = a;
            for (t = n = 0; !i[t]; t ^= f || 1, n = s[n] || 1) {
                var u = (u = n ^ n << 1 ^ n << 2 ^ n << 3 ^ n << 4) >> 8 ^ 255 & u ^ 99;
                i[t] = u, o[u] = t;
                var p = 16843009 * b[a = b[f = b[t]]] ^ 65537 * a ^ 257 * f ^ 16843008 * t,
                    h = 257 * b[u] ^ 16843008 * u;
                for (a = 0; 4 > a; a++) r[a][t] = h = h << 24 ^ h >>> 8, d[a][u] = p = p << 24 ^ p >>> 8;
            }
            for (a = 0; 5 > a; a++) r[a] = r[a].slice(0), d[a] = d[a].slice(0);
        }
        if (r = this.a[0][4], d = this.a[1], b = 1, 4 !== (n = e.length) && 6 !== n && 8 !== n) throw new c.exception.invalid("10");
        for (this.g = [o = e.slice(0), t = []], e = n; e < 4 * n + 28; e++) i = o[e - 1], (0 == e % n || 8 === n && 4 == e % n) && (i = r[i >>> 24] << 24 ^ r[i >> 16 & 255] << 16 ^ r[i >> 8 & 255] << 8 ^ r[255 & i], 0 == e % n && (i = i << 8 ^ i >>> 24 ^ b << 24, b = b << 1 ^ 283 * (b >> 7))), o[e] = o[e - n] ^ i;
        for (n = 0; e; n++, e--) i = o[3 & n ? e : e - 4], t[n] = 4 >= e || 4 > n ? i : d[0][r[i >>> 24]] ^ d[1][r[i >> 16 & 255]] ^ d[2][r[i >> 8 & 255]] ^ d[3][r[255 & i]];
    }, c.cipher.aes.prototype = {
        encrypt: function (e) {
            return a(this, e, 0);
        },
        decrypt: function (e) {
            return a(this, e, 1);
        },
        a: [[[], [], [], [], []], [[], [], [], [], []]]
    }, c.bitArray = {
        bitSlice: function (e, a, t) {
            return e = c.bitArray.c(e.slice(a / 32), 32 - (31 & a)).slice(1), void 0 === t ? e : c.bitArray.clamp(e, t - a);
        },
        extract: function (e, a, c) {
            var t = Math.floor(-a - c & 31);
            return (-32 & (a + c - 1 ^ a) ? e[a / 32 | 0] << 32 - t ^ e[a / 32 + 1 | 0] >>> t : e[a / 32 | 0] >>> t) & (1 << c) - 1;
        },
        concat: function (e, a) {
            if (0 === e.length || 0 === a.length) return e.concat(a);
            var t = e[e.length - 1],
                n = c.bitArray.getPartial(t);
            return 32 === n ? e.concat(a) : c.bitArray.c(a, n, 0 | t, e.slice(0, e.length - 1));
        },
        bitLength: function (e) {
            var a = e.length;
            return 0 === a ? 0 : 32 * (a - 1) + c.bitArray.getPartial(e[a - 1]);
        },
        clamp: function (e, a) {
            if (32 * e.length < a) return e;
            var t = (e = e.slice(0, Math.ceil(a / 32))).length;
            return a &= 31, 0 < t && a && (e[t - 1] = c.bitArray.partial(a, e[t - 1] & 2147483648 >> a - 1, 1)), e;
        },
        partial: function (e, a, c) {
            return 32 === e ? a : (c ? 0 | a : a << 32 - e) + 1099511627776 * e;
        },
        getPartial: function (e) {
            return Math.round(e / 1099511627776) || 32;
        },
        equal: function (e, a) {
            if (c.bitArray.bitLength(e) !== c.bitArray.bitLength(a)) return !1;
            var t,
                n = 0;
            for (t = 0; t < e.length; t++) n |= e[t] ^ a[t];
            return 0 === n;
        },
        c: function (e, a, t, n) {
            var f;
            for (void 0 === n && (n = []); 32 <= a; a -= 32) n.push(t), t = 0;
            if (0 === a) return n.concat(e);
            for (f = 0; f < e.length; f++) n.push(t | e[f] >>> a), t = e[f] << 32 - a;
            return f = e.length ? e[e.length - 1] : 0, e = c.bitArray.getPartial(f), n.push(c.bitArray.partial(a + e & 31, 32 < a + e ? t : n.pop(), 1)), n;
        },
        f: function (e, a) {
            return [e[0] ^ a[0], e[1] ^ a[1], e[2] ^ a[2], e[3] ^ a[3]];
        },
        byteswapM: function (e) {
            var a;
            for (a = 0; a < e.length; ++a) {
                var c = e[a];
                e[a] = c >>> 24 | c >>> 8 & 65280 | (65280 & c) << 8 | c << 24;
            }
            return e;
        }
    }, c.codec.utf8String = {
        fromBits: function (e) {
            var a,
                t,
                n = "",
                f = c.bitArray.bitLength(e);
            for (a = 0; a < f / 8; a++) 0 == (3 & a) && (t = e[a / 4]), n += String.fromCharCode(t >>> 8 >>> 8 >>> 8), t <<= 8;
            return decodeURIComponent(escape(n));
        },
        toBits: function (e) {
            e = unescape(encodeURIComponent(e));
            var a,
                t = [],
                n = 0;
            for (a = 0; a < e.length; a++) n = n << 8 | e.charCodeAt(a), 3 == (3 & a) && (t.push(n), n = 0);
            return 3 & a && t.push(c.bitArray.partial(8 * (3 & a), n)), t;
        }
    }, c.codec.base64 = {
        b: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
        fromBits: function (e, a, t) {
            var n = "",
                f = 0,
                r = c.codec.base64.b,
                d = 0,
                i = c.bitArray.bitLength(e);
            for (t && (r = r.substr(0, 62) + "-_"), t = 0; 6 * n.length < i;) n += r.charAt((d ^ e[t] >>> f) >>> 26), 6 > f ? (d = e[t] << 6 - f, f += 26, t++) : (d <<= 6, f -= 6);
            for (; 3 & n.length && !a;) n += "=";
            return n;
        },
        toBits: function (e, a) {
            e = e.replace(/\s|=/g, "");
            var t,
                n = [],
                f = 0,
                r = c.codec.base64.b,
                d = 0;
            for (a && (r = r.substr(0, 62) + "-_"), a = 0; a < e.length; a++) {
                if (0 > (t = r.indexOf(e.charAt(a)))) throw new c.exception.invalid("12");
                26 < f ? (f -= 26, n.push(d ^ t >>> f), d = t << 32 - f) : d ^= t << 32 - (f += 6);
            }
            return 56 & f && n.push(c.bitArray.partial(56 & f, d, 1)), n;
        }
    }, c.codec.base64url = {
        fromBits: function (e) {
            return c.codec.base64.fromBits(e, 1, 1);
        },
        toBits: function (e) {
            return c.codec.base64.toBits(e, 1);
        }
    }, c.codec.bytes = {
        fromBits: function (e) {
            var a,
                t,
                n = [],
                f = c.bitArray.bitLength(e);
            for (a = 0; a < f / 8; a++) 0 == (3 & a) && (t = e[a / 4]), n.push(t >>> 24), t <<= 8;
            return n;
        },
        toBits: function (e) {
            var a,
                t = [],
                n = 0;
            for (a = 0; a < e.length; a++) n = n << 8 | e[a], 3 == (3 & a) && (t.push(n), n = 0);
            return 3 & a && t.push(c.bitArray.partial(8 * (3 & a), n)), t;
        }
    };
    c.mode.cbc = {
        name: "cbc",
        encrypt: function (e, a, t, n) {
            if (n && n.length) throw new c.exception.invalid("1");
            if (128 !== c.bitArray.bitLength(t)) throw new c.exception.invalid("2");
            var f = c.bitArray,
                r = f.f,
                d = f.bitLength(a),
                i = 0,
                o = [];
            if (7 & d) throw new c.exception.invalid("3");
            for (n = 0; i + 128 <= d; n += 4, i += 128) t = e.encrypt(r(t, a.slice(n, n + 4))), o.splice(n, 0, t[0], t[1], t[2], t[3]);
            return d = 16843009 * (16 - (d >> 3 & 15)), t = e.encrypt(r(t, f.concat(a, [d, d, d, d]).slice(n, n + 4))), o.splice(n, 0, t[0], t[1], t[2], t[3]), o;
        },
        decrypt: function (e, a, t, n) {
            if (n && n.length) throw new c.exception.invalid("4");
            if (128 !== c.bitArray.bitLength(t)) throw new c.exception.invalid("5");
            if (127 & c.bitArray.bitLength(a) || !a.length) throw new c.exception.corrupt("6");
            var f = c.bitArray,
                r = f.f,
                d = [];
            for (n = 0; n < a.length; n += 4) {
                var i = a.slice(n, n + 4);
                t = r(t, e.decrypt(i)), d.splice(n, 0, t[0], t[1], t[2], t[3]), t = i;
            }
            if (0 == (i = 255 & d[n - 1]) || 16 < i) throw new c.exception.corrupt("7");
            if (t = 16843009 * i, !f.equal(f.bitSlice([t, t, t, t], 0, 8 * i), f.bitSlice(d, 32 * d.length - 8 * i, 32 * d.length))) throw new c.exception.corrupt("9");
            return f.bitSlice(d, 0, 32 * d.length - 8 * i);
        }
    },
        e.exports && (e.exports = c);
})

function _typeof(o) {
    return module.exports = _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
        return typeof o
    }
        : function (o) {
            return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o
        }
        ,
        _typeof(o)
}

n = [28, 34, 18, 1, 83, 23, 3, 32, 9, 8, 2, 1, 3, 29, 9, 11, 4, 37, 1, 0, 10, 2, 31, 57, 9, 12, 15, 40, 19, 9, 38, 22, 34, 18, 1, 86, 23, 3, 32, 9, 22, 52, 18, 28, 15, 17, 24, 30, 23, 3, 9, 1, 16383, 6, 9, 44, 36, 51, 47, 1, 0, 2, 1, 0, 7, 18, 16, 12, 32, 24, 1, 83, 10, 15, 22, 6, 20, 1, 0, 29, 4, 5, 31, 6, 27, 26, 6, 3, 6, 17, 33, 13, 23, 35, 40, 3, 0, 13, 3, 0, 30, 21, 3, 256, 5, 0, 12, 21, 20, 0, 28, 0, 16, 3, 0, 19, 0, 21, 3, 256, 5, 0, 26, 34, 0, 28, 0, 36, 22, 17, 33, 24, 42, 37, 2, 38, 23, 4, 2, 43, 28, 29, 23, 3, 6, 31, 34, 24, 20, 16, 36, 13, 1, 18, 12, 9, 8, 15, 27, 7, 4, 21, 5, 7, 15, 17, 5, 10, 5, 35, 5, 42, 7, 15, 39, 17, 5, 10, 5, 35, 5, 38, 14, 0, 1]
a = "7718151d121403 e99c878d8c8f80878c8d bedbc6ced1cccacd 3d5b48535e49545253 4f2e222b b8ded1d6dfddca e2839292 c8acaeb8a1ac 81e7e8ede4f5e8ece4 4e283e38 45292a2624292c21 2e5d575d5a4b43 cfbba6a2aabcbbaea2bf f89d808c fd8e988e8e949293b499 f9989a9a9c959c8b96949c8d9c8b 9dfcf1ffe8f0dce8e9f5f2eff4e7f8f9 763417020213040f3f181019 d2b0b3a6a6b7a0ab9eb7a4b7be 50123531333f3e23 92f0f7fcf1fafff3e0f9def7e4f7fe fd9f9188988992928995b8939c9f919899 6e0c1c0f000a 1a7868737d726e747f6969 7310121e1601123206071b1c011a091617 7f1c10120f1e0c0c aecacbd8c7cdcbe1dcc7cbc0dacfdac7c1c0 2d49485b444e487d445548417f4c594442 ddb8b3bcbfb1b899b8bfa8ba 0a6f787847796d c2a4adacb691abb8a791a7b6b6abaca5 b6dad7d8d1c3d7d1d3 98d4f9edf6fbf0d7e8ecf1f7f6ebcbe1f6fb b4d8dbd7d5c0dddbdaf5c1c0dcdbc6ddced1d0 5a3635393b2e3335341f343b38363f3e b8d4d7dbd9ccd1d7d6eadddccddbdddcf9dbdbcdcad9dbc1 4d20242e3f223d252223280c383925223f24372829 137e7c77767f a1cfc4d5d6ced3caf5d8d1c4 127c7d667b747b7173667b7d7c537e7760665367667a7d607b687776 acc2c3d8c5cac5cfcdd8c5c3c2edd9d8c4c3dec5d6c9c8 3856574c515e515b594c5157567a595c5f5d794d4c50574a51425d5c acc2c3d8c5cac5cfcdd8c5c3c2ffc3d9c2c8edd9d8c4c3dec5d6c9c8 02726b7a676e5063766b6d 5c2c303d283a332e31 265547404367544347 b4c7d7c6d1d1dafcd1ddd3dcc0 3340504156565d675c43 7d0e1e0f1818132a14190915 0b584f405d6e7978626465 ec9f988d98999fae8d9ea489858b8498 44373d37302129 02746770716b6d6c bec9d7d8d7fbd0dfdcd2dbda efb8868986a6818980 2057494e444f57684549474854 9ee9f7f0faf1e9c9f7faeaf6 5a3f282817293d 137a60507b7261747a7d74 cea2abb8aba2 5a363f3c2e 9fedf6f8f7eb 35415a45 690b061d1d0604 1d6a74796975 d1b9b4b8b6b9a5 5f0c0c161b c88a9b9b818c f49581809bbe9b9d9a9190 b9cad0ded7d8d5eacdcbdcd7decdd1 a7cdd2d4d3edc8cec9c2c3 b6c5d3d5c3c4d3 c5a3b7a0b4b0a0aba6bc 6f1c1b1d060108060916 45212a2b20 3046515c4555 4f032e3a212c27003f3b2620213c1c36212c 631302111006 740700061d1a131d120d 641405100c 2c5f4f494249 aacbc9c9cfc6cfd8c5c7cfdecfd8 bad3c9fbc8c8dbc3 88e4ede6effce0 44202b2a21 92e4f3fee7f7 90e0e5e3f8 df9dbeababbaada696b1b9b0 491e202f2000272f26 483b292e2d093a2d29 a2d1d6d0cbccc5 156574676670 5738353d323423 d0a0a5a3b8 fa8a8f8992 04404254 c4a1bcb4abb6b0b7 92f7eae2fde0e6e1 82e0e7f5e3f0e7 3108007473700775737405740470067209740774027002720077057005757777087408 3172047704777577047703770477027704770177047700770477077704770677047705 8ce0e9e2ebf8e4 3f535a51584b57 605018 fe8d8b9c8d8a8c 310149 72111a13003306 adcec5ccdfecd9 4e283c21230d262f3c0d212a2b f48481879c b9dad6dddcda 1b6e6f7d23486f6972757c 9beff4d9f2efe8 99faf6fdfcfa 6015140658331412090e07 7c08133e15080f 13707a637b7661 69080c1a ea87858e8f 1c7f7e7f 0f6a616c7d767f7b 82e1ede6e7e1 7c1e1d0f194a48 dfb9adb0b29db6abac 62534c544c57 665748504853 2050524f44 4129353531326472006473076473072031313224226c2c2e23282d246f2c24283534202f6f222e2c 7105140205 ef879b9b9f9ccadcaecadda9cadda98e9f9f9c8a8cc282808d86838ac19c8a8cc19b8a9c9bc19c8e81849a8e86c18c8082 a1c4cfd7 d8a8aab7bc 563537353e331d332f daeeeabbebeabebfe8 3c4c4e5358 90f5fee6 6a1a18050e 3c48594f48 37444e4443525a 4c2a3c3a 4017181f1f362532716e726e701f030303031f fa94958d 1d7178737a6975 63000b0211200c07062217 b6d5ded7c4f5d9d2d3f7c2 93f5e1fcfed0fbf2e1d0fcf7f6 e597848b818a88 3954565d5c55 d1a2a8a2a5b4bc 3e53515a5b52 6f1c161c1b0a02 a1d2d8d2d5c4cc 14607d79716760757964 b7c3dedad2c4c3d6dac7 e18e91848f8885 e7889782898e83 04696031 9eedeaeccaf1cba6 b7c4c3c5ded9d0ded1ce bfdcd0d1dcdecb ee9d9a9c 4a3e25193e3823242d ec9f80858f89 caaeacba83ae 0a7e63676f797e6b677a dfb3b0bcbeb396bb d3b7b5a39ab7 57243225213225033e3a32133e3131 5a333e 086c6e78416c f19d9e92909db895 add9c4c0c8ded9ccc0dd 5e373a 56313322103f3a33052f2522333b1b373837313324 b4c7c0d5c0e7cddad7 e2878c94 287d7b6d7a776c697c697778697c60 7b171a080f3a18181e08081e1f2f12161e fc909d8f88b19398959a959998a8959199 771a181312 5122382b34 bcccced3c8d3c8c5ccd9 5132303d3d 1c6c696f74 3a4a4f4952 1e6e716e 3e525b50594a56 deb2bbb0b9aab6 e78b828980938f daaaafa9b2 6c0009020b1804 a7cbc2c9c0d3cf b7dbd2d9d0c3df abc7cec5ccdfc3 bdd1d8d3dac9d5 0b676e656c7f63 1e727b70796a76 552520263d 98f4fdf6ffecf0 c6aaa3a8a1b2ae e08c858e879488 b8decbd5d7dcdd 09687979 accddcdce5c8 9df2edf8f3f4f9 0867786d66416c 42372c2b2d2c2b26 9eebf0f7f1f0d7fa cda0aea5a4a9 80ede3e8c9e4 305456405954 98fcfee8d1fc 026e6d61636e6b66 d0bcbfb3b1bc99b4 43252a2f26372a2e26 ed998480889e998c809d 2f4e4b4b6a5d5d405d a3c4c6d7e5cacdc4c6d191 234c4d604c4e53425050604b424d4446 4629202005292b36273535052e27282123 42313b3136272f 92f1fdffe2f3e1e1 d4a7ada7a0b1b9 90f3fffde0f1e3e3 64171d17100109 a1cdc4cfc6d5c9 a2d1dbd1d6c7cf 1a6972737c6e 9ae9e3e9eefff7 d6a6a3a5be 51353823343225383e3f 64100b220d1c0100 0b646d6d4a68686e676e7964666e7f6e7948636a656c6e 4033393334252d 45242626202920372a2820312037 c6b5bfb5b2a3ab 67060404020b0215080a02130215 ef9c969c9b8a82 8deceeeee8e1e8ffe2e0e8f9e8ff d3bfb6bdb4a7bb 394a404a4d5c54 adcccecec8c1c8dfc2c0c8d9c8df 5b2833323d2f e4979d97908189 34555757515851465b5951405146 ccbcb9bfa4 b8ccd7fed1c0dddc b1c5def7d8c9d4d5 87f3e8c1eeffe2e3 a9c6c7eed0dbc6dacac6d9cceac1c8c7cecc 83ece5e5c4faf1ecf0e0ecf3e6c0ebe2ede4e6 54272d27203139 6e09171c01 2a5953595e4f47 c8afb1baa7 493a303a3d2c24 0a6d737865 b6dad3d8d1c2de 8efdf7fdfaebe3 f19688839e 087b60616e7c c5b6bcb6b1a0a8 c7a0beb5a8 443431372c 8efae1c8e7f6ebea 63170c250a1b0607 8afee5cce3f2efee cababfb9a2 7d081319181b14131819 c7b7b2b4af 315f445d5d 117e737b747265 a6d6d3d5ce 3f4c4b4d565158565946 25434a576044464d 8cfcf9ffe4 443734282d30 a6cac3c8c1d2ce 7003001c1904 6509000b02110d 4f3d2a3f232e2c2a 29595c5a41 295c474d4c4f40474c4d d7a7a2a4bf 1f6d7a6f737e7c7a 8efefbfde6 412d242f263529 35565d54477441 385b50594a794c b4d7dcd5c6f5c0 aadadfd9c2 c5b5b0b6ad 98fbf0f9eadbf7fcfdd9ec 503c353e372438 c6b5aaafa5a3 4b272e252c3f23 b1d2d9d0c3f0c5 d8a8adabb0 067463766a676563 062334333437 176572677b767472 280d1a1d1a1f 0a786f7a666b696f a3869196919b c6b4a3b6aaa7a5a3 9abfa8afa8a3 e39186938f828086 143126212655 09797c7a61 345e5b5d5a 4f2e3f3f23262c2e3b2620216a7d0937623838386229203d22623a3d232a212c202b2a2b 97f6e7e7fbfef4f6e3fef8f9b2a5d1fde4f8f9 640f011d17 fb979e959c8f93 77141819031219035a030e0712 4b3f2407243c2e39082a382e dbafb497b4acbea998baa8be 81f2f5e0f3f5f2d6e8f5e9 e6888991 51243f353437383f3435 15627077 8cf9e2e8e9eae5e2e9e8 2c41587f494f595e4558557f454b42 7f120b2c1a1c0a0d160b062c160a1e 45277d a6cec3c7c2c3d4 f29f97869a9d96 74333120 1b6f744e6b6b7e69587a687e 5c1b1908 12555746 b3c5d2dfc6d6fcd5 74121d1a131106 2d5e5949 c7b2b5ab b2d6d3c6d3 e78f8286838295 c1aea3aba4a2b5 18707d797c7d6a 771f1216131205 f5908d9096 0a4d4f5e 9ef1fcf4fbfdea b1dad4c8c2 19757c777e6d71 d8b4bdb6bfacb0 c3a5acb186a2a0ab 066e6775497168567469766374727f 077473756e6960 d0bfb2bab5b3a4 e9999c9a81 1f6a717b7a7976717a7b 176762647f 610f140d0d 49393c3a21 f89e978abd999b90 a9d9dcdac1 97f1f8e5d2f6f4ff fc8c898f94 8ae0e5e3e4 b6d5d9d8d5d7c2 8bf8e4f9ff a4c2cbd6e1c5c7cc 1161646279 5b31343235 d6919382 becdcaccd7d0d9 b2c2c7c1da 7c1d0c0c1005 9dede8eef5 adccddddc1d4 7c0f080e15121b151a05 2c4049424b5844 b1c1c4c2d9 563726263a2f dca9b2b8b9bab5b2b9b8 8be7eee5ecffe3 c5a9a0aba2b1ad 14667b616071 aac898 147e76 126571 9bebf8 8afdf2 4f2a2139 03666d75 157270615a627b45677a657067616c51706676677c65617a67 650200112406060a100b112c0b030a361c0b06 d7a0a5bea3b6b5bbb2 ed988389888b84838889 5c392a3d30 96e5e2f7f5fd 4e3d3a2f2d25 a6cfc8c5cad3c2c3d5 7b1a0b0b56081e090d12181e 7c0f081d1f17 a4cdcac7c8d1c0c1d7 4021303033253236292325 9aeef5c9eee8f3f4fd 01686f626d74656472 defbeb9cb0bfaab7a8bbfbeceebdb1babbfbeb9a 3c565e 89feea 2e594d c4b3a7 593d3c3b2c3e f38390 641407 1d6b786f6e7472736e 8dfdee 2f594a5d5c4640415c 036d6c6766 9ee9e6 0e696b7a4179605e7c617e6b7c7a774a6b7d6d7c677e7a617c 3a4e55694e4853545d c9a0a7aaa5bcadacba ae8b9becc0cfdac7d8cb8b9c9ecdc1cacb8b9bea 1d78736b 5e3d31303d3f2a 701d1445 88fbfdeafbfcfae1e6ef f080858398 e5849595899c 7101040219 aacbdadac6d3 85e9e0ebe2f1ed 0b7b7e7863 077772746f 4f6a7c0b6a7c0b c4b4b1b7ac 7b11141215 1a797574797b6e 3d5158535a4955 f79b929990839f fc9f949d8ebf939899bd88 245750564d4a434d425d 1c7178294873547964 20434f4e434154 2b484445484a5f ea878b9a 8de7e2e4e3 402171 bedf8c 9dfbf4f3faf8ef 4f2e7c 771643 244511 6a0b5c 660751 92eaa2 9dfcac 4a2b78 a1c092 2c4d18 503167 325f5607734040534b 126a22 374f07 eb8fda 234e4716774c6b465b a7c6c3c3e2d5d5c8d5 ec8f8d808f81988b9f858b 483b3c3a21262f212e31 660e0307020314 d0bda4b7a3b9b7 224e474c45564a e7868383a6978e 690d0f19361a000e0736050c070e1d01 39555c575e4d51 2f4e4b4b6e5f46 e98d8f99b69a808e87 650b0a12 f2939696b780809d80 51223037340238363f0638253902382430 bfdedbdbfecfd6 80e4e6f0dff3e9e7ee 711f1e06 d1a3b4a0a4b4a2a5 93e0e7e1fafdf4 69050c070e1d01 34575c5546775b50517540 bfd3dad1d8cbd7 bcd0d9d2dbc8d4 0967667e 274510 52343e3d3d20 9cf2f3eb 9cf7f9e5ef 95f9f0fbf2e1fd 116278767f 116278767f4678657942786470 2052455155455354 b7c5d2c6c2d2c4c3e0dec3dfe4dec2d6 a3c5cacdc4c6d1 badcd3d4dddfc8 85e8fce2f0e4f7e1 b7d0d2c3f6d4d4d8c2d9c3fed9d1d8e4ced9d4 4d2a28390c2e2e2238233904232b221e34232e 7e1c4f c0ada9aea990b2afa7b2a1ad 026f6b6c6b52706d6570636f 4a2b3a3a032e e4828d8a838196 b8d5d1d6d1e8cad7dfcad9d5 a9c8d9d9e0cd b5d8dcdbdce5c7dad2c7d4d8 85e4f5f5cce1 28495858414c 23454a4d444651 503120203934 553a25303b3c31 f597c3 1877687d76717c 4127282f262433 afc0dfcac1c6cb 95e0fbfcfafbfcf1 62040b0c050710 e3968d8a8c8d8a87 8ce1efe4e5e8 f5939c9b929087 6d000e050409 6c191f091e05020a03 f7919e99909285 225157 3f4a4c5a4d56515950 8cfff5fff8e9e1e5e2eae3 72141b1c151700 8ffceb a3d0dad0d7c6cecacdc5cc ea9993999e8f8783848c85 bed0dbcac9d1ccd5d7d0d8d1 64020d0a030116 6c1f08 701e1504071f021b191e161f 19777c6d6e766b7250777f76 fd9f8f949a958993988e8e 5036393e373522 d4a7b0 385a4a515f504c565d4b4b e88a9a818f809c868d9b9b 650704111100171c0c0b030a e6808f88818394 9ceff8 c2a0a3b6b6a7b0bbabaca4ad c684a7b2b2a3b4bf8fa8a0a9 7003041f02111715191e161f 88fbec 0172756e73606664686f676e e6b5928994878183af888089 e0828581838f8e93 a9cfc0c7ceccdb 87f4e3 fd9f989c9e92938e 98dafdf9fbf7f6eb a7d4c2cbc2c4d3c2c3d3c2dfd3d5c6c9c0c2 9ff9f6f1f8faed f58691 54273138313720313020312c2026353a3331 2675434a434552434272435e527447484143 e985889c878a8186999d8086879a 2f494641484a5d 661502 8ce0edf9e2efe4e3fcf8e5e3e2ff 723e13071c111a3d02061b1d1c01210b1c11 42352b242b2b2c242d 394a5d e89f818e8181868e87 aff8c6c9c6e6c1c9c0 7a150a1f14131e 52213726003322263d20113d3c343b35 3659415a 6f0601061b2c0e1b 5a352d36 7b1d12151c1e09 a5cad2c9 f699819a 6b0a0f0f2a1b02240901 402124240130290f222a 0d6c6969487f7f627f426f67 48292c2c0d3a3a273a072a22 2b4c4e5f784e5858424445624f 73151a1d141601 b1c2c2 d2a7bcb6b7b4bbbcb7b6 6506090c060e311704060e dbb5b48ba9b4a3a2 5d343334290d2f322524 dcb8baacb5b8 bcdad5d2dbd9ce 7a1b0a0a131e abf4d9cadbdfc4d9 80e9eee9f4d3e5eef3eff2 d3b5babdb4b6a1 781a1117 b5dbdac2 57313e39303225 4e29273d a4c5c0c0e5d4cd ea8e8c9ab58384839e a1cfced6 2d43425a a1c7c8cfc6c4d3 69080d0d281900 d9bdbfa986aab0acb8 16787961 5332373712233a 99fdffe9c6eaf0ecf8c6f5fcf7feedf1 533f363d34273b e5828091a98a8684918c8a8b 8febeae9e6e1eadffde0ffeafdfbf6 e6818392aa898587928f8988 fa898f99999f8989 90e3e5f3f3f5e3e3 c5a6a4a9a9 16707f78717364 6d0c1d1d0114 b8cbd1cdd9ecd1d5ddca a0c6c9cec7c5d2 f7969393b6879e bfdbd9cfe0d6d1d6cbecc6d1dc e886879f ceaaa8be8da2a7ada59abcafada5 4d242324391d3f223534".split(" ")
t = function e(c, n) {
    n = a[c -= 0],
        void 0 === e.XxlVCV && (e.boloGX = function (e) {
            for (var c = "", n = e.length, a = parseInt("0x" + e.substr(0, 2)), t = 2; t < n; t += 2) {
                var f = parseInt("0x" + e.charAt(t) + e.charAt(t + 1));
                c += String.fromCharCode(f ^ a)
            }
            return decodeURIComponent(c)
        }
            ,
            e.vnXrNp = {},
            e.XxlVCV = !0);
    var t = e.vnXrNp[c];
    return void 0 === t ? (void 0 === e.ztPaGX && (e.ztPaGX = !0),
        n = e.boloGX(n),
        e.vnXrNp[c] = n) : n = t,
        n
};

function getSessionId() {
    const hexChars = "0123456789abcdef";
    const chars = Array.from({ length: 36 }, () =>
        hexChars.charAt(Math.floor(Math.random() * 16))
    );
    chars[14] = "4";
    chars[19] = hexChars.charAt((parseInt(chars[19], 16) & 0x3) | 0x8);
    [8, 13, 18, 23].forEach(pos => chars[pos] = "");
    return chars.join("") + "03";
}

sessionId = getSessionId()

e = _typeof
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
Tc = {
    "system": {
        "errMsg": "getSystemInfo:ok",
        "albumAuthorized": true,
        "benchmarkLevel": -1,
        "bluetoothEnabled": false,
        "brand": "microsoft",
        "cameraAuthorized": true,
        "fontSizeSetting": 15,
        "language": "zh_CN",
        "locationAuthorized": true,
        "locationEnabled": true,
        "microphoneAuthorized": true,
        "model": "microsoft",
        "notificationAuthorized": true,
        "notificationSoundEnabled": true,
        "pixelRatio": 1,
        "platform": "windows",
        "power": 100,
        "safeArea": {
            "bottom": 780,
            "height": 780,
            "left": 0,
            "right": 414,
            "top": 0,
            "width": 414
        },
        "screenHeight": 780,
        "screenWidth": 414,
        "statusBarHeight": 20,
        "system": "Windows 11 x64",
        "theme": "light",
        "version": "4.0.5.23",
        "wifiEnabled": true,
        "windowHeight": 780,
        "windowWidth": 414,
        "SDKVersion": "3.10.3",
        "enableDebug": false,
        "host": {
            "appId": "",
            "env": "WeChat"
        },
        "appName": "weixin",
        "devicePixelRatio": 1,
        "brightness": 0.5,
        "LaunchOptionsSync": "{\"path\":\"pages/index/index\",\"query\":{},\"scene\":1074,\"referrerInfo\":{},\"apiCategory\":\"default\"}",
        "WifiInfo": "",
        "networkType": "wifi",
        "StorageInfo": "{\"currentSize\":516,\"errMsg\":\"getStorageInfo:ok\",\"keys\":[\"_lx_sdk_data\",\"app_onshow_path\",\"logan_days_info\",\"UNIFIED\",\"pepper_channel\",\"oneid_mp\",\"UUID\",\"__PerfLastVisitVersion__\",\"OPENID_USER_REPORT\",\"__MTUC__authInfo\",\"pepper-cache-home-module\",\"WXOWLKEY-unionId\",\"40a10de2\",\"pepper_search_history\",\"storage-loc-key\",\"loganlog_2025-10-27_1_0\",\"_lx_sdk_quickOptions\",\"llog_config\",\"__MTUC__wxIds\",\"_openId3\",\"pepper-cache-home-banner\",\"LLog_7jlz_2$_1761573669230_shared\",\"logan_session_token\",\"wx-safety-request-horn\"],\"limitSize\":10000}",
        "BatteryInfo": "{\"errMsg\":\"getBatteryInfo:ok\",\"isCharging\":true,\"level\":100}"
    },
    "fpv": "1.6.5",
    "timestamp": 1761576265,
    "ext": [
        0,
        1,
        2,
        0,
        4
    ],
    "app": "wxc32c3ddb81865d74",
    "openid": "orY-a7aLYtlG5amc3ZQFjafo56gw",
    "sessionId": sessionId,
    "dfpid": "798u33w7204y5u63y0z24z6ywy9xv31780z74vzv94z979788291755v",
    "localid": "1761572739518CGYUAUS60e593ce0a815b08d658526270cd17d63123",
    "filetime": 1761572739518,
    "reportTick": 1,
    "fsmode": [
        1761555920,
        1761589564,
        16822,
        0
    ],
    "e": "Error\n    at https://usr/appservice.app.js:2009:57614\n    at Function.<anonymous> (https://usr/appservice.app.js:2009:54100)\n    at f (a805bc3ad643247fab363e328d5880f5-13909-V0FTdWJDb250ZXh0Lmpz.cachedata:1:151799)\n    at a805bc3ad643247fab363e328d5880f5-13909-V0FTdWJDb250ZXh0Lmpz.cachedata:1:152242\n    at Function.<anonymous> (a805bc3ad643247fab363e328d5880f5-13909-V0FTdWJDb250ZXh0Lmpz.cachedata:1:115822)\n    at Function.<anonymous> (a805bc3ad643247fab363e328d5880f5-13909-V0FTdWJDb250ZXh0Lmpz.cachedata:1:147131)\n    at p (59147b0d33436fb68b055e4e80883412-13909-V0FTZXJ2aWNlTWFpbkNvbnRleHQuanM=.cachedata:1:158013)\n    at 59147b0d33436fb68b055e4e80883412-13909-V0FTZXJ2aWNlTWFpbkNvbnRleHQuanM=.cachedata:1:158456\n    at 59147b0d33436fb68b055e4e80883412-13909-V0FTZXJ2aWNlTWFpbkNvbnRleHQuanM=.cachedata:1:148161",
    "location": {
        "errMsg": "getLocation:ok",
        "latitude": 30.59276008605957,
        "longitude": 114.30525207519531,
        "getLocationType": "WX",
        "timeId": 1761574002831,
        "_factitious": true
    }
}
wc = xc = true
Cc = [0, 1, 2, 0, 4]
Sc = {
    "appId": Tc['app'],
    "sessionId": sessionId,
    "openId": Tc['openid'],
    "factitiouslocation": true
}
_c = function _c() {
    return {
        "timestamp": Tc['filetime'],
        "localId": Tc['localid'],
        "dfpId": Tc['dfpid'],
        "serverTimeDiff": 1145,
        "expirationTime": 1761574003201
    }
}
ke = {
    "DFP": ["app", "dfpid", "filetime", "fpv", "localid", "system", "timestamp", "ext", "sessionId"],
    "system": ["accelerometer", "albumAuthorized", "BatteryInfo", "batteryLevel", "Beacons", "benchmarkLevel", "bluetoothEnabled", "brand", "brightness", "cameraAuthorized", "compass", "deviceOrientation", "devicePixelRatio", "enableDebug", "errMsg", "fontSizeSetting", "language", "LaunchOptionsSync", "locationAuthorized", "locationEnabled", "locationReducedAccuracy", "microphoneAuthorized", "model", "networkType", "notificationAlertAuthorized", "notificationAuthorized", "notificationBadgeAuthorized", "notificationSoundAuthorized", "pixelRatio", "platform", "safeArea", "screenHeight", "screenTop", "screenWidth", "SDKVersion", "statusBarHeight", "system", "version", "wifiEnabled", "WifiInfo", "windowHeight", "windowWidth"],
    "BatteryInfo": ["errMsg", "isCharging", "level"],
    "safeArea": ["left", "right", "top", "bottom", "width", "height"],
    "WifiInfo": ["SSID", "BSSID", "autoJoined", "signalStrength", "justJoined", "secure", "frequency"]
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
Be = Uint8Array,
    Re = Uint16Array,
    Ue = Uint32Array,
    Ee = new Be([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]),
    Pe = new Be([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]),
    Le = new Be([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]),
    Ge = function (e, c) {
        for (var n = new Re(31), a = 0; 31 > a; ++a) n[a] = c += 1 << e[a - 1];
        for (e = new Ue(n[30]), a = 1; 30 > a; ++a) for (c = n[a]; c < n[a + 1]; ++c) e[c] = c - n[a] << 5 | a;
        return [n, e];
    },
    ze = Ge(Ee, 2),
    qe = ze[1];
ze[0][28] = 258, qe[258] = 28;
for (var Ve = Ge(Pe, 0)[1], Fe = new Re(32768), We = 0; 32768 > We; ++We) {
    var Xe = (43690 & We) >>> 1 | (21845 & We) << 1;
    Xe = (61680 & (Xe = (52428 & Xe) >>> 2 | (13107 & Xe) << 2)) >>> 4 | (3855 & Xe) << 4, Fe[We] = ((65280 & Xe) >>> 8 | (255 & Xe) << 8) >>> 1;
}
var He = function (e, c, n) {
    for (var a = e.length, t = 0, f = new Re(c); t < a; ++t) ++f[e[t] - 1];
    var r = new Re(c);
    for (t = 0; t < c; ++t) r[t] = r[t - 1] + f[t - 1] << 1;
    if (n) {
        for (n = new Re(1 << c), f = 15 - c, t = 0; t < a; ++t) if (e[t]) {
            var d = t << 4 | e[t],
                o = c - e[t],
                i = r[e[t] - 1]++ << o;
            for (o = i | (1 << o) - 1; i <= o; ++i) n[Fe[i] >>> f] = d;
        }
    } else for (n = new Re(a), t = 0; t < a; ++t) n[t] = Fe[r[e[t] - 1]++] >>> 15 - e[t];
    return n;
},
    Ke = new Be(288);
for (We = 0; 144 > We; ++We) Ke[We] = 8;
for (We = 144; 256 > We; ++We) Ke[We] = 9;
for (We = 256; 280 > We; ++We) Ke[We] = 7;
for (We = 280; 288 > We; ++We) Ke[We] = 8;
var Ye = new Be(32);
for (We = 0; 32 > We; ++We) Ye[We] = 5;
var Ze,
    Qe,
    $e,
    ec = He(Ke, 9, 0),
    cc = He(Ye, 5, 0),
    nc = function (e, c, n) {
        (null == c || 0 > c) && (c = 0), (null == n || n > e.length) && (n = e.length);
        var a = new (e instanceof Re ? Re : e instanceof Ue ? Ue : Be)(n - c);
        return a.set(e.subarray(c, n)), a;
    },
    ac = function (e, c, n) {
        n <<= 7 & c, e[c = c / 8 >> 0] |= n, e[c + 1] |= n >>> 8;
    },
    tc = function (e, c, n) {
        n <<= 7 & c, e[c = c / 8 >> 0] |= n, e[c + 1] |= n >>> 8, e[c + 2] |= n >>> 16;
    },
    fc = function (e, c) {
        for (var n = [], a = 0; a < e.length; ++a) e[a] && n.push({
            s: a,
            f: e[a]
        });
        var t = n.length;
        if (e = n.slice(), !t) return [new Be(0), 0];
        if (1 == t) return (c = new Be(n[0].s + 1))[n[0].s] = 1, [c, 1];
        n.sort(function (e, c) {
            return e.f - c.f;
        }), n.push({
            s: -1,
            f: 25001
        }), a = n[0];
        var f = n[1],
            r = 0,
            d = 1,
            o = 2;
        for (n[0] = {
            s: -1,
            f: a.f + f.f,
            l: a,
            r: f
        }; d != t - 1;) a = n[n[r].f < n[o].f ? r++ : o++], f = n[r != d && n[r].f < n[o].f ? r++ : o++], n[d++] = {
            s: -1,
            f: a.f + f.f,
            l: a,
            r: f
        };
        for (f = e[0].s, a = 1; a < t; ++a) e[a].s > f && (f = e[a].s);
        var i = new Re(f + 1);
        if ((d = rc(n[d - 1], i, 0)) > c) {
            for (n = a = 0, r = 1 << (f = d - c), e.sort(function (e, c) {
                return i[c.s] - i[e.s] || e.f - c.f;
            }); a < t && (o = e[a].s, i[o] > c); ++a) n += r - (1 << d - i[o]), i[o] = c;
            for (n >>>= f; 0 < n;) t = e[a].s, i[t] < c ? n -= 1 << c - i[t]++ - 1 : ++a;
            for (; 0 <= a && n; --a) t = e[a].s, i[t] == c && (--i[t], ++n);
            d = c;
        }
        return [new Be(i), d];
    },
    rc = function e(c, n, a) {
        return -1 == c.s ? Math.max(e(c.l, n, a + 1), e(c.r, n, a + 1)) : n[c.s] = a;
    },
    dc = function (e) {
        for (var c = e.length; c && !e[--c];);
        for (var n = new Re(++c), a = 0, t = e[0], f = 1, r = function (e) {
            n[a++] = e;
        }, d = 1; d <= c; ++d) if (e[d] == t && d != c) ++f; else {
            if (!t && 2 < f) {
                for (; 138 < f; f -= 138) r(32754);
                2 < f && (r(10 < f ? f - 11 << 5 | 28690 : f - 3 << 5 | 12305), f = 0);
            } else if (3 < f) {
                for (r(t), --f; 6 < f; f -= 6) r(8304);
                2 < f && (r(f - 3 << 5 | 8208), f = 0);
            }
            for (; f--;) r(t);
            f = 1, t = e[d];
        }
        return [n.subarray(0, a), c];
    },
    oc = function (e, c) {
        for (var n = 0, a = 0; a < c.length; ++a) n += e[a] * c[a];
        return n;
    },
    ic = function (e, c, n) {
        var a = n.length;
        e[c = ((c += 2) / 8 >> 0) + (7 & c && 1)] = 255 & a, e[c + 1] = a >>> 8, e[c + 2] = 255 ^ e[c], e[c + 3] = 255 ^ e[c + 1];
        for (var t = 0; t < a; ++t) e[c + t + 4] = n[t];
        return 8 * (c + 4 + a);
    },
    sc = function (e, c, n, a, t, f, r, d, o, i, s) {
        ac(c, s++, n), ++t[256];
        for (var u = (n = fc(t, 15))[0], b = n[1], h = (n = fc(f, 15))[0], p = n[1], l = (n = dc(u))[0], g = n[1], v = (n = dc(h))[0], y = n[1], m = new Re(19), w = 0; w < l.length; ++w) m[31 & l[w]]++;
        for (w = 0; w < v.length; ++w) m[31 & v[w]]++;
        n = (w = fc(m, 7))[0], w = w[1];
        for (var x = 19; 4 < x && !n[Le[x - 1]]; --x);
        var S = i + 5 << 3,
            C = oc(t, Ke) + oc(f, Ye) + r;
        if (t = oc(t, u) + oc(f, h) + r + 14 + 3 * x + oc(m, n) + (2 * m[16] + 3 * m[17] + 7 * m[18]), S <= C && S <= t) return ic(c, s, e.subarray(o, o + i));
        if (ac(c, s, 1 + (t < C)), s += 2, t < C) {
            for (e = He(u, b, 0), o = u, i = He(h, p, 0), u = He(n, w, 0), ac(c, s, g - 257), ac(c, s + 5, y - 1), ac(c, s + 10, x - 4), s += 14, w = 0; w < x; ++w) ac(c, s + 3 * w, n[Le[w]]);
            for (s += 3 * x, l = [l, v], g = 0; 2 > g; ++g) for (v = l[g], w = 0; w < v.length; ++w) y = 31 & v[w], ac(c, s, u[y]), s += n[y], 15 < y && (ac(c, s, v[w] >>> 5 & 127), s += v[w] >>> 12);
        } else e = ec, o = Ke, i = cc, h = Ye;
        for (w = 0; w < d; ++w) 255 < a[w] ? (y = a[w] >>> 18 & 31, tc(c, s, e[y + 257]), s += o[y + 257], 7 < y && (ac(c, s, a[w] >>> 23 & 31), s += Ee[y]), n = 31 & a[w], tc(c, s, i[n]), s += h[n], 3 < n && (tc(c, s, a[w] >>> 5 & 8191), s += Pe[n])) : (tc(c, s, e[a[w]]), s += o[a[w]]);
        return tc(c, s, e[256]), s + o[256];
    },
    uc = new Ue([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]),
    bc = new Be(0),
    hc = function () {
        for (var e = new Ue(256), c = 0; 256 > c; ++c) {
            for (var n = c, a = 9; --a;) n = (1 & n && 3988292384) ^ n >>> 1;
            e[c] = n;
        }
        return e;
    }(),
    pc = function () {
        var e = 4294967295;
        return {
            p: function (c) {
                for (var n = e, a = 0; a < c.length; ++a) n = hc[255 & n ^ c[a]] ^ n >>> 8;
                e = n;
            },
            d: function () {
                return 4294967295 ^ e;
            }
        };
    },
    lc = function (e, c, n, a, t) {
        return function (e, c, n, a, t, f) {
            var r = e.length,
                d = new Be(a + r + 5 * (1 + Math.floor(r / 7e3)) + t),
                o = d.subarray(a, d.length - t),
                i = 0;
            if (!c || 8 > r) for (n = 0; n <= r; n += 65535) (c = n + 65535) < r ? i = ic(o, i, e.subarray(n, c)) : (o[n] = f, i = ic(o, i, e.subarray(n, r))); else {
                var s = uc[c - 1];
                c = s >>> 13, s &= 8191;
                for (var u = (1 << n) - 1, b = new Re(32768), h = new Re(u + 1), p = Math.ceil(n / 3), l = 2 * p, g = function (c) {
                    return (e[c] ^ e[c + 1] << p ^ e[c + 2] << l) & u;
                }, v = new Ue(25e3), y = new Re(288), m = new Re(32), w = 0, x = 0, S = (n = 0, 0), C = 0, A = 0; n < r; ++n) {
                    var O = g(n),
                        I = 32767 & n,
                        D = h[O];
                    if (b[I] = D, h[O] = I, C <= n) {
                        var T = r - n;
                        if ((7e3 < w || 24576 < S) && 423 < T) {
                            i = sc(e, o, 0, v, y, m, x, S, A, n - A, i), S = w = x = 0, A = n;
                            for (var j = 0; 286 > j; ++j) y[j] = 0;
                            for (j = 0; 30 > j; ++j) m[j] = 0;
                        }
                        var N = 2,
                            _ = 0,
                            k = s,
                            J = I - D & 32767;
                        if (2 < T && O == g(n - J)) {
                            O = Math.min(c, T) - 1;
                            var M = Math.min(32767, n);
                            for (T = Math.min(258, T); J <= M && --k && I != D;) {
                                if (e[n + N] == e[n + N - J]) {
                                    for (j = 0; j < T && e[n + j] == e[n + j - J]; ++j);
                                    if (j > N) {
                                        if (N = j, _ = J, j > O) break;
                                        var B = Math.min(J, j - 2),
                                            R = 0;
                                        for (j = 0; j < B; ++j) {
                                            var U = n - J + j + 32768 & 32767,
                                                E = U - b[U] + 32768 & 32767;
                                            E > R && (R = E, D = U);
                                        }
                                    }
                                }
                                J += (I = D) - (D = b[I]) + 32768 & 32767;
                            }
                        }
                        _ ? (v[S++] = 268435456 | qe[N] << 18 | Ve[_], C = 31 & qe[N], _ = 31 & Ve[_], x += Ee[C] + Pe[_], ++y[257 + C], ++m[_], C = n + N, ++w) : (v[S++] = e[n], ++y[e[n]]);
                    }
                }
                i = sc(e, o, f, v, y, m, x, S, A, n - A, i), f || (i = ic(o, i, bc));
            }
            return nc(d, 0, a + ((i / 8 >> 0) + (7 & i && 1)) + t);
        }(e, null == c.level ? 6 : c.level, null == c.mem ? Math.ceil(1.5 * Math.max(8, Math.min(13, Math.log(e.length)))) : 12 + c.mem, n, a, !t);
    },
    gc = function (e, c, n) {
        for (; n; ++c) e[c] = n, n >>>= 8;
    },
    vc = {
        gzipSync: M,
        compressSync: M,
        strToU8: function (e, c) {
            var n = e.length;
            if (!c && "undefined" != typeof TextEncoder) return new TextEncoder().encode(e);
            for (var a = new Be(e.length + (e.length >>> 1)), t = 0, f = function (e) {
                a[t++] = e;
            }, r = 0; r < n; ++r) {
                if (t + 5 > a.length) {
                    var d = new Be(t + 8 + (n - r << 1));
                    d.set(a), a = d;
                }
                128 > (d = e.charCodeAt(r)) || c ? f(d) : 2048 > d ? (f(192 | d >>> 6), f(128 | 63 & d)) : 55295 < d && 57344 > d ? (f(240 | (d = 65536 + (1047552 & d) | 1023 & e.charCodeAt(++r)) >>> 18), f(128 | d >>> 12 & 63), f(128 | d >>> 6 & 63), f(128 | 63 & d)) : (f(224 | d >>> 12), f(128 | d >>> 6 & 63), f(128 | 63 & d));
            }
            return nc(a, 0, t);
        }
    };

function V() {
    try {
        var e = Math.round(new Date().getTime() / 1e3);
        Tc.timestamp = e;
    } catch (e) {
        Tc.timestamp = "";
    }
}

function k(e, c) {
    var n;
    if ("undefined" == typeof Symbol || null == e[Symbol.iterator]) {
        if (Array.isArray(e) || (n = function (e, c) {
            if (e) {
                if ("string" == typeof e) return _(e, c);
                var n = Object.prototype.toString.call(e).slice(8, -1);
                return "Object" === n && e.constructor && (n = e.constructor.name), "Map" === n || "Set" === n ? Array.from(e) : "Arguments" === n || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n) ? _(e, c) : void 0;
            }
        }(e)) || c && e && "number" == typeof e.length) {
            n && (e = n);
            var a = 0;
            return function () {
                return a >= e.length ? {
                    done: !0
                } : {
                    done: !1,
                    value: e[a++]
                };
            };
        }
        throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    return (n = e[Symbol.iterator]()).next.bind(n);
}

function M(e, c) {
    void 0 === c && (c = {});
    var n = pc(),
        a = e.length;
    n.p(e);
    var t = (e = lc(e, c, 10 + (c.filename && c.filename.length + 1 || 0), 8)).length,
        f = c;
    if (c = f.filename, e[0] = 31, e[1] = 139, e[2] = 8, e[8] = 2 > f.level ? 4 : 9 == f.level ? 2 : 0, e[9] = 3, 0 != f.mtime && gc(e, 4, Math.floor(new Date(f.mtime || Date.now()) / 1e3)), c) for (e[3] = 8, f = 0; f <= c.length; ++f) e[f + 10] = c.charCodeAt(f);
    return gc(e, t - 8, n.d()), gc(e, t - 4, a), e;
}

function B(e) {
    function c() {
        for (var e, c = ["91EBA6DBE4E5A7C8E6E3A3C1F4A4DFF9E9", "C5F5FDF5F2F5F3F5F0F5F1F5F6F5F7F5F4"], n = [], a = 0; a < c["length"]; a++) {
            e = "";
            for (var f = c[a], r = f["length"], d = parseInt("0x" + f["substr"](0, 2)), o = 2; o < r; o += 2) {
                var i = parseInt("0x" + f["charAt"](o) + f["charAt"](o + 1));
                e += String["fromCharCode"](i ^ d);
            }
            n["push"](e);
        }
        return n;
    }

    var n = Je["codec"]["utf8String"]["toBits"](c()[0]),
        a = Je["codec"]["utf8String"]["toBits"](c()[1]);
    return n = new Je["cipher"]["aes"](n), e = Je["mode"]["cbc"]["encrypt"](n, e, a), Je["codec"]["base64"]["fromBits"](e);
}

function get_i() {
    var c = "w1.2";
    if (V(), wc || U(mc), !xc) try {
        Date.now(),
            function () {
                try {
                    Cc[0] = "undefined" == typeof NativeClient ? 0 : 1, Cc[1] = "undefined" == typeof addEventListener ? 0 : 1;
                    try {
                        var e = wx.getPublicLibVersion(),
                            c = 0 < Object.keys(e).length ? e.system == Tc.system.platform ? 1 : 0 : 2;
                    } catch (e) {
                    }
                    Cc[2] = c, Cc[3] = "undefined" == typeof __WeixinJSBridge ? 0 : 1;
                    var n = 4;
                    if (wx.canIUse("getNFCAdapter")) {
                        var a,
                            t = wx.getNFCAdapter(),
                            f = ((a = {}).not_open = 13001, a.no_nfc = 13e3, a);
                        t.startDiscovery({
                            success: function (e) {
                                void 0 === e.errCode ? (n = 1, Cc[4] = n, t.stopDiscovery({
                                    success: function (e) {
                                    },
                                    fail: function (e) {
                                    }
                                })) : (e.errCode == f.no_nfc && (n = 3, Cc[4] = n), e.errCode == f.not_open && (n = 2, Cc[4] = n));
                            },
                            fail: function (e) {
                                n = 0, Cc[4] = n;
                            }
                        });
                    }
                    Cc[4] = n;
                } catch (e) {
                    try {
                        yc && yc.addError("ext", e);
                    } catch (e) {
                    }
                }
            }(), xc = !0;
    } catch (e) {
        try {
            yc && yc.addError("getFingerExt", e);
        } catch (e) {
        }
    }
    Tc.ext = Cc, Tc.app = Sc.appId, Tc.openid = Sc.openId, Tc.unionid = Sc.unionId, Tc.mchid = Sc.mchId, Tc.sessionId = Sc.sessionId;
    var n,
        a = _c();
    Tc.dfpid = a.dfpId, Tc.localid = a.localId, Tc.filetime = a.timestamp;

    var f = (n = Tc, JSON["stringify"](function c(n, a) {
        var f,
            r = [];
        for (a = k(a); !(f = a())["done"];) {
            var d = n[f = f["value"]];
            if ("LaunchOptionsSync" === f && d && (d = JSON["parse"](d), d = JSON["stringify"]({
                path: d["path"],
                scene: d["scene"]
            })), "accelerometer" === f && d && Array["isArray"](d) && 0 < d["length"]) {
                var o,
                    i = [];
                for (d = k(d); !(o = d())["done"];) (o = o["value"]).x && o.y && o.z && i["push"]([o.x, o.y, o.z]);
                d = i;
            }
            "BatteryInfo" !== f && "WifiInfo" !== f && "safeArea" !== f || d && "string" == e(d) && (d = JSON["parse"](d)), "object" == e(d) && f in ke ? r["push"](c(d, ke[f])) : r["push"](d);
        }
        return r;
    }(n, ke["DFP"])));
    f = vc.gzipSync(vc.strToU8(f)), c += B(Je.codec.bytes.toBits(f));

    return c;
}


// ------------------------------------------------------------------------------------------------------------------------------------------------------------
Gc = get_i()


Hc = 55

Lc = {
    "b7": 1761574001,
    "b1": {
        "miniProgram": {
            "appId": Tc['app'],
            "envVersion": "release",
            "version": "1.0.69"
        }
    },
    "b8": Hc,
    "b2": "pepper/pages/goodDetail/pages/shopList/index"
}


zc = {
    finger: {
        std: function std() {
            return 1145
        }
    }
}

n = [28, 34, 18, 1, 83, 23, 3, 32, 9, 8, 2, 1, 3, 29, 9, 11, 4, 37, 1, 0, 10, 2, 31, 57, 9, 12, 15, 40, 19, 9, 38, 22, 34, 18, 1, 86, 23, 3, 32, 9, 22, 52, 18, 28, 15, 17, 24, 30, 23, 3, 9, 1, 16383, 6, 9, 44, 36, 51, 47, 1, 0, 2, 1, 0, 7, 18, 16, 12, 32, 24, 1, 83, 10, 15, 22, 6, 20, 1, 0, 29, 4, 5, 31, 6, 27, 26, 6, 3, 6, 17, 33, 13, 23, 35, 40, 3, 0, 13, 3, 0, 30, 21, 3, 256, 5, 0, 12, 21, 20, 0, 28, 0, 16, 3, 0, 19, 0, 21, 3, 256, 5, 0, 26, 34, 0, 28, 0, 36, 22, 17, 33, 24, 42, 37, 2, 38, 23, 4, 2, 43, 28, 29, 23, 3, 6, 31, 34, 24, 20, 16, 36, 13, 1, 18, 12, 9, 8, 15, 27, 7, 4, 21, 5, 7, 15, 17, 5, 10, 5, 35, 5, 42, 7, 15, 39, 17, 5, 10, 5, 35, 5, 38, 14, 0, 1]
Vc = ["Z", "m", "s", "e", "r", "b", "B", "o", "H", "Q", "t", "N", "P", "+", "w", "O", "c", "z", "a", "/", "L", "p", "n", "g", "G", "8", "y", "J", "q", "4", "2", "K", "W", "Y", "j", "0", "D", "S", "f", "d", "i", "k", "x", "3", "V", "T", "1", "6", "I", "l", "U", "A", "F", "M", "9", "7", "h", "E", "C", "v", "u", "R", "X", "5"]
Fc = '1.2'
Wc = '798u33w7204y5u63y0z24z6ywy9xv31780z74vzv94z979788291755v'
Xc = Tc['app']

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function get_encrypt() {
    Ae = "0123456789abcdef".split("")

    function c(e, a) {
        var c = e[0]
            , t = e[1]
            , n = e[2]
            , o = e[3];
        t = i(t = i(t = i(t = i(t = d(t = d(t = d(t = d(t = r(t = r(t = r(t = r(t = f(t = f(t = f(t = f(t, n = f(n, o = f(o, c = f(c, t, n, o, a[0], 7, -680876936), t, n, a[1], 12, -389564586), c, t, a[2], 17, 606105819), o, c, a[3], 22, -1044525330), n = f(n, o = f(o, c = f(c, t, n, o, a[4], 7, -176418897), t, n, a[5], 12, 1200080426), c, t, a[6], 17, -1473231341), o, c, a[7], 22, -45705983), n = f(n, o = f(o, c = f(c, t, n, o, a[8], 7, 1770035416), t, n, a[9], 12, -1958414417), c, t, a[10], 17, -42063), o, c, a[11], 22, -1990404162), n = f(n, o = f(o, c = f(c, t, n, o, a[12], 7, 1804603682), t, n, a[13], 12, -40341101), c, t, a[14], 17, -1502002290), o, c, a[15], 22, 1236535329), n = r(n, o = r(o, c = r(c, t, n, o, a[1], 5, -165796510), t, n, a[6], 9, -1069501632), c, t, a[11], 14, 643717713), o, c, a[0], 20, -373897302), n = r(n, o = r(o, c = r(c, t, n, o, a[5], 5, -701558691), t, n, a[10], 9, 38016083), c, t, a[15], 14, -660478335), o, c, a[4], 20, -405537848), n = r(n, o = r(o, c = r(c, t, n, o, a[9], 5, 568446438), t, n, a[14], 9, -1019803690), c, t, a[3], 14, -187363961), o, c, a[8], 20, 1163531501), n = r(n, o = r(o, c = r(c, t, n, o, a[13], 5, -1444681467), t, n, a[2], 9, -51403784), c, t, a[7], 14, 1735328473), o, c, a[12], 20, -1926607734), n = d(n, o = d(o, c = d(c, t, n, o, a[5], 4, -378558), t, n, a[8], 11, -2022574463), c, t, a[11], 16, 1839030562), o, c, a[14], 23, -35309556), n = d(n, o = d(o, c = d(c, t, n, o, a[1], 4, -1530992060), t, n, a[4], 11, 1272893353), c, t, a[7], 16, -155497632), o, c, a[10], 23, -1094730640), n = d(n, o = d(o, c = d(c, t, n, o, a[13], 4, 681279174), t, n, a[0], 11, -358537222), c, t, a[3], 16, -722521979), o, c, a[6], 23, 76029189), n = d(n, o = d(o, c = d(c, t, n, o, a[9], 4, -640364487), t, n, a[12], 11, -421815835), c, t, a[15], 16, 530742520), o, c, a[2], 23, -995338651), n = i(n, o = i(o, c = i(c, t, n, o, a[0], 6, -198630844), t, n, a[7], 10, 1126891415), c, t, a[14], 15, -1416354905), o, c, a[5], 21, -57434055), n = i(n, o = i(o, c = i(c, t, n, o, a[12], 6, 1700485571), t, n, a[3], 10, -1894986606), c, t, a[10], 15, -1051523), o, c, a[1], 21, -2054922799), n = i(n, o = i(o, c = i(c, t, n, o, a[8], 6, 1873313359), t, n, a[15], 10, -30611744), c, t, a[6], 15, -1560198380), o, c, a[13], 21, 1309151649), n = i(n, o = i(o, c = i(c, t, n, o, a[4], 6, -145523070), t, n, a[11], 10, -1120210379), c, t, a[2], 15, 718787259), o, c, a[9], 21, -343485551),
            e[0] = c + e[0] & 4294967295,
            e[1] = t + e[1] & 4294967295,
            e[2] = n + e[2] & 4294967295,
            e[3] = o + e[3] & 4294967295
    }

    function n(e, a, c, t, n, f) {
        return ((a = (a + e & 4294967295) + (t + f & 4294967295) & 4294967295) << n | a >>> 32 - n) + c & 4294967295
    }

    function f(e, a, c, t, f, r, d) {
        return n(a & c | ~a & t, e, a, f, r, d)
    }

    function r(e, a, c, t, f, r, d) {
        return n(a & t | c & ~t, e, a, f, r, d)
    }

    function d(e, a, c, t, f, r, d) {
        return n(a ^ c ^ t, e, a, f, r, d)
    }

    function i(e, a, c, t, f, r, d) {
        return n(c ^ (a | ~t), e, a, f, r, d)
    }

    function o(e) {
        var a, t = e.length, n = [1732584193, -271733879, -1732584194, 271733878];
        for (a = 64; a <= e.length; a += 64) {
            var f, r = e.subarray(a - 64, a), d = [];
            for (f = 0; 64 > f; f += 4)
                d[f >> 2] = r[f] + (r[f + 1] << 8) + (r[f + 2] << 16) + (r[f + 3] << 24);
            c(n, d)
        }
        for (e = e.subarray(a - 64),
            f = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            a = 0; a < e.length; a++)
            f[a >> 2] |= e[a] << (a % 4 << 3);
        if (f[a >> 2] |= 128 << (a % 4 << 3),
            55 < a)
            for (c(n, f),
                a = 0; 16 > a; a++)
                f[a] = 0;
        return f[14] = 8 * t,
            c(n, f),
            n
    }

    function b(e) {
        for (var a = 0; a < e.length; a++) {
            for (var c = a, t = e[a], n = "", f = 0; 4 > f; f++)
                n += Ae[t >> 8 * f + 4 & 15] + Ae[t >> 8 * f & 15];
            e[c] = n
        }
        return e.join("")
    }

    return {
        md5: function (e) {
            return b(o(e));
        },
        md5Array: o,
        md5ToHex: b
    }
}

be = get_encrypt()

function W(e, c) {
    void 0 === c && (c = !1);
    var n = [];
    e = e["split"]("&");
    for (var a = 0; a < e["length"]; a++) {
        var f = e[a]["split"]("=");
        if (!(1 > f["length"])) {
            var r = f[0];
            r = r["replace"](/\+/g, " "), 1 === f["length"] ? c ? n["push"]([decodeURIComponent(r), "undefined"]) : n["push"]([decodeURIComponent(r), ""]) : (f = f[1]["replace"](/\+/g, " "), n["push"]([decodeURIComponent(r), decodeURIComponent(f)]));
        }
    }
    return n;
}

function F(c, n, a) {
    if (void 0 === a && (a = !1), a) for (var f in n) void 0 === (a = n[f]) ? c["push"]([Z(f), "undefined"]) : null === a ? c["push"]([Z(f), "null"]) : "object" == e(a) ? c["push"]([Z(f), Z(JSON["stringify"](n[f]))]) : c["push"]([Z(f), Z(n[f])]); else n["forEach"](function (e) {
        c["push"]([Z(e[0]), Z(e[1])]);
    });
}

function Z(e) {
    return encodeURIComponent(e)["replace"](/!/g, "%21")["replace"](/'/g, "%27")["replace"](/\(/g, "%28")["replace"](/\)/g, "%29")["replace"](/\*/g, "%2A");
}

function $(e, c) {
    return e[0] < c[0] ? -1 : e[0] > c[0] ? 1 : e[1] < c[1] ? -1 : e[1] > c[1] ? 1 : 0;
}

function X(e) {
    e = encodeURIComponent(e);
    for (var c = [], n = 0; n < e["length"]; n++) {
        var a = e["charAt"](n);
        "%" === a ? (a = e["charAt"](n + 1) + e["charAt"](n + 2), a = parseInt(a, 16), c["push"](a), n += 2) : c["push"](a["charCodeAt"](0));
    }
    return c;
}

function Y(e) {
    var c = [];
    return c[0] = e >>> 24 & 255, c[1] = e >>> 16 & 255, c[2] = e >>> 8 & 255, c[3] = 255 & e, c;
}

function K(e) {
    for (var c = [], n = 0; n < e["length"]; n += 2) {
        var a = e["charAt"](n) + e["charAt"](n + 1);
        a = parseInt(a, 16), c["push"](a);
    }
    return c;
}

Qc = function () {
    for (var c, n, a = 256, f = []; a--; f[a] = c >>> 0) for (n = 8, c = a; n--;) c = 1 & c ? c >>> 1 ^ 3988292384 : c >>> 1;
    return function (c) {
        if ("string" == e(c)) {
            for (var n = 0, a = -1; n < c["length"]; ++n) a = f[255 & a ^ c["charCodeAt"](n)] ^ a >>> 8;
            return 306674911 ^ a;
        }
        for (n = 0, a = -1; n < c["length"]; ++n) a = f[255 & a ^ c[n]] ^ a >>> 8;
        return 306674911 ^ a;
    };
}();

function Q(e, c, n) {
    for (var a, f = [], r = c; r < n; r += 3) c = (e[r] << 16 & 16711680) + (e[r + 1] << 8 & 65280) + (255 & e[r + 2]), f["push"](Vc[(a = c) >> 18 & 63] + Vc[a >> 12 & 63] + Vc[a >> 6 & 63] + Vc[63 & a]);
    return f["join"]("");
}

function ae(e, c) {
    var n = e["length"];
    c ^= n;
    for (var a = 0; 4 <= n;) {
        var f = 1540483477 * (65535 & (f = 255 & e[a] | (255 & e[++a]) << 8 | (255 & e[++a]) << 16 | (255 & e[++a]) << 24)) + ((1540483477 * (f >>> 16) & 65535) << 16);
        c = 1540483477 * (65535 & c) + ((1540483477 * (c >>> 16) & 65535) << 16) ^ (f = 1540483477 * (65535 & (f ^= f >>> 24)) + ((1540483477 * (f >>> 16) & 65535) << 16)), n -= 4, ++a;
    }
    switch (n) {
        case 3:
            c ^= (255 & e[a + 2]) << 16;
        case 2:
            c ^= (255 & e[a + 1]) << 8;
        case 1:
            c = 1540483477 * (65535 & (c ^= 255 & e[a])) + ((1540483477 * (c >>> 16) & 65535) << 16);
    }
    return ((c = 1540483477 * (65535 & (c ^= c >>> 13)) + ((1540483477 * (c >>> 16) & 65535) << 16)) ^ c >>> 15) >>> 0 ^ 1540483477;
}

function ee(e, c) {
    for (var n = !1, a = 0, f = Object["keys"](e); a < f["length"]; a++) {
        var r = f[a];
        if ("content-type" === r["toLowerCase"]() && (n = !0, e[r] && e[r]["toLowerCase"]()["startsWith"](c))) return !0;
    }
    return c === Zc && !n;
}

Yc = 'application/x-www-form-urlencoded'
Zc = 'application/json'

function H(e) {
    return 16200 < e["length"] && (e = e["slice"](0, 16200)), e;
}

function mtgsig(c, a) {
    if (void 0 === a && (a = !1), Hc += 1, Lc["b8"] = Hc, c) {
        var r = c["header"] || {},
            d = (c["method"] || "GET")["toUpperCase"](),
            o = "GET" !== d && ee(r, Yc),
            i = ("GET" !== d && ee(r, Zc), new Date()["valueOf"]() + zc["finger"]["std"]());
        r = c["url"] || "";
        var s = c["data"];
        c["header"] && "object" == e(c["header"]) || (c["header"] = {});
        var u = "/",
            b = [];
        (r = /^(?:([A-Za-z]+):)?(\/{0,3})([0-9.\-A-Za-z]+)(?::(\d+))?(?:\/([^?#]*))?(?:\?([^#]*))?(?:#(.*))?$/["exec"](r)) && (r[5] && (u += r[5]), r[6] && (b = W(r[6])));
        var h = [],
            p = "",
            l = [];
        if ("GET" === d) {
            if ("object" == e(s) && 0 < Object["keys"](s)["length"]) {
                if (F(h, s, !0), r && r[6] && 0 < b["length"]) {
                    var g = {};
                    (b = W(r[6], !0))["forEach"](function (e) {
                        s["hasOwnProperty"](e[0]) || (g[e[0]] = e[1]);
                    }), F(h, g, !0);
                }
            } else F(h, b);
        } else if (F(h, b), o) if ("string" == e(s)) p = s; else if ("object" == e(s)) {
            !function (e, c, n) {
                if (void 0 === n && (n = !1), n) for (var a in c) void 0 === (n = c[a]) ? e["push"]([encodeURIComponent(a), "undefined"]) : null === n ? e["push"]([encodeURIComponent(a), "null"]) : e["push"]([encodeURIComponent(a), encodeURIComponent(c[a])]); else c["forEach"](function (c) {
                    e["push"]([Z(c[0]), Z(c[1])]);
                });
            }(l, s, !0);
            var v = [];
            l["forEach"](function (e) {
                v["push"](e[0] + "=" + e[1]);
            }), p = v["join"]("&");
        }
        var y = "";
        a && (y = Gc), []["concat"](h), h["sort"]($);
        var m = [];
        h["forEach"](function (e) {
            m["push"](e[0] + "=" + e[1]);
        });
        var w = X(d + " " + u + " " + m["join"]("&"));
        if (o || "GET" === d || null == s || ("string" == e(s) ? w["push"]["apply"](w, H(X(s))) : w["push"]["apply"](w, H(X(JSON["stringify"](s))))), 0 < p["length"] && w["push"]["apply"](w, H(X(p))), a = "", "undefined" != ("undefined" == typeof getCurrentPages ? "undefined" : e(getCurrentPages))) {
            d = getCurrentPages();
            try {
                d && (a = 0 === d["length"] ? "" : d[d["length"] - 1]["route"] || "");
            } catch (e) {
            }
        }
        Lc["b2"] = a, a = "", void 0 !== (d = function () {
            for (var c, a = 183; ;) switch (n[a++]) {
                case 0:
                    var f = 0;
                    var l = Y(d = 4294967295 & i),
                        g = new Uint8Array(X(y)["concat"](l)),
                        v = be["md5"](g),
                        m = K(v["substring"](0, 15));
                    m[7] = 255 & (f ^ Qc(l)), m["push"]["apply"](m, l), m["push"]["apply"](m, Y(4294967295 & Qc(m)));
                    var x = function (e) {
                        for (var c, a = [], f = Function.prototype.call, r = 0; ;) switch (n[r++]) {
                            case 1:
                                a.push(n[r++]);
                                continue;
                            case 2:
                                a.push(d);
                                continue;
                            case 3:
                                a.length -= 2;
                                continue;
                            case 4:
                                a[a.length - 0] = [];
                                continue;
                            case 6:
                                o += a[a.length - 1];
                                continue;
                            case 8:
                                var d = a.pop();
                                continue;
                            case 9:
                                a.pop();
                                continue;
                            case 10:
                                var o = a.pop();
                                continue;
                            case 11:
                                var i = a.pop();
                                continue;
                            case 12:
                                var s = a.pop();
                                continue;
                            case 15:
                                a.push(o);
                                continue;
                            case 17:
                                a.push(o + 16383 > s ? s : o + 16383);
                                continue;
                            case 18:
                                a.push(null);
                                continue;
                            case 19:
                                a[a.length - 2] = a[a.length - 2] < a[a.length - 1];
                                continue;
                            case 22:
                                a.push(u);
                                continue;
                            case 23:
                                a[a.length - 3] = f.call(a[a.length - 3], a[a.length - 2], a[a.length - 1]);
                                continue;
                            case 24:
                                a[a.length - 5] = f.call(a[a.length - 5], a[a.length - 4], a[a.length - 3], a[a.length - 2], a[a.length - 1]);
                                continue;
                            case 28:
                                a.push(e);
                                continue;
                            case 29:
                                a[a.length - 2] %= a[a.length - 1];
                                continue;
                            case 30:
                                a.length -= 4;
                                continue;
                            case 31:
                                a.push(i);
                                continue;
                            case 32:
                                a[a.length - 2] = a[a.length - 2][a[a.length - 1]];
                                continue;
                            case 34:
                                a.push(t);
                                continue;
                            case 36:
                                a.push((1 === i ? (c = e[d - 1], u["push"](Vc[c >> 2] + Vc[c << 4 & 63] + "==")) : 2 === i && (c = (e[d - 2] << 8) + e[d - 1], u["push"](Vc[c >> 10] + Vc[c >> 4 & 63] + Vc[c << 2 & 63] + "=")), u["join"]("")));
                                continue;
                            case 37:
                                var u = a.pop();
                                continue;
                            case 38:
                                !a.pop() && (r += 25);
                                continue;
                            case 40:
                                a.push(s);
                                continue;
                            case 44:
                                r -= 30;
                                continue;
                            case 47:
                                return;
                            case 51:
                                return a.pop();
                            case 52:
                                a.push(Q);
                                continue;
                            case 57:
                                a[a.length - 2] -= a[a.length - 1];
                        }
                    }(m["concat"](function (e, c) {
                        for (var a, f = [], r = Function.prototype.call, d = 93; ;) switch (n[d++]) {
                            case 0:
                                f.pop();
                                continue;
                            case 2:
                                f.length -= 4;
                                continue;
                            case 3:
                                f.push(n[d++]);
                                continue;
                            case 5:
                                f[f.length - 2] = f[f.length - 2] < f[f.length - 1];
                                continue;
                            case 12:
                                !f.pop() && (d += 6);
                                continue;
                            case 13:
                                var o = f.pop();
                                continue;
                            case 16:
                                d -= 12;
                                continue;
                            case 17:
                                f.push(null);
                                continue;
                            case 19:
                                var i = f[f.length - 1];
                                continue;
                            case 20:
                                s[i] = f[f.length - 1];
                                continue;
                            case 21:
                                f.push(i);
                                continue;
                            case 22:
                                f.push(function (e, c, a) {
                                    for (var f = [], r = Function.prototype.call, d = 59; ;) switch (n[d++]) {
                                        case 1:
                                            f.push(n[d++]);
                                            continue;
                                        case 2:
                                            var o = f.pop();
                                            continue;
                                        case 3:
                                            f.push(b++);
                                            continue;
                                        case 4:
                                            f.push(b);
                                            continue;
                                        case 5:
                                            f.push(u);
                                            continue;
                                        case 6:
                                            f.pop();
                                            continue;
                                        case 7:
                                            var i = f.pop();
                                            continue;
                                        case 10:
                                            f[f.length - 3] = r.call(f[f.length - 3], f[f.length - 2], f[f.length - 1]);
                                            continue;
                                        case 12:
                                            f.push(a);
                                            continue;
                                        case 13:
                                            return f.pop();
                                        case 15:
                                            f.length -= 2;
                                            continue;
                                        case 16:
                                            var s = f.pop();
                                            continue;
                                        case 17:
                                            d -= 10;
                                            continue;
                                        case 18:
                                            f[f.length - 0] = [];
                                            continue;
                                        case 20:
                                            var u = f.pop();
                                            continue;
                                        case 22:
                                            f[f.length - 2] = f[f.length - 2][f[f.length - 1]];
                                            continue;
                                        case 23:
                                            return;
                                        case 24:
                                            f.push(null);
                                            continue;
                                        case 26:
                                            f.push((i = (i + e[o = (o + 1) % 256]) % 256, c = e[o], e[o] = e[i], e[i] = c, s["push"](a["charCodeAt"](b) ^ e[(e[o] + e[i]) % 256])));
                                            continue;
                                        case 27:
                                            !f.pop() && (d += 5);
                                            continue;
                                        case 29:
                                            var b = f.pop();
                                            continue;
                                        case 31:
                                            f[f.length - 2] = f[f.length - 2] < f[f.length - 1];
                                            continue;
                                        case 32:
                                            f.push(t);
                                            continue;
                                        case 33:
                                            f.push(s);
                                    }
                                });
                                continue;
                            case 23:
                                return;
                            case 24:
                                f.push(a);
                                continue;
                            case 26:
                                !f.pop() && (d += 5);
                                continue;
                            case 28:
                                f.push(i++);
                                continue;
                            case 30:
                                i = f.pop();
                                continue;
                            case 33:
                                f.push(s);
                                continue;
                            case 34:
                                f.push((o = (o + s[i] + e[i % e["length"]] + 31) % 256, a = s[i], s[i] = s[o], s[o] = a));
                                continue;
                            case 35:
                                f[f.length - 0] = [];
                                continue;
                            case 36:
                                d -= 11;
                                continue;
                            case 37:
                                f[f.length - 5] = r.call(f[f.length - 5], f[f.length - 4], f[f.length - 3], f[f.length - 2], f[f.length - 1]);
                                continue;
                            case 38:
                                return f.pop();
                            case 40:
                                var s = f.pop();
                                continue;
                            case 42:
                                f.push(c);
                        }
                    }(m, JSON["stringify"](Lc)))),
                        S = ae(w, i),
                        C = Y(S),
                        A = ae(new Uint8Array(X(x)), i),
                        O = Y(A),
                        I = K(be["md5ToHex"]([S, A, S ^ d, S ^ A ^ d])),
                        D = (void 0 === (c = C["concat"](O)["concat"](I)) && (c = []), c["map"](function (e) {
                            for (var c = [], a = 137; ;) switch (n[a++]) {
                                case 1:
                                    c.push("e");
                                    continue;
                                case 2:
                                    c.push("0");
                                    continue;
                                case 3:
                                    c.push("5");
                                    continue;
                                case 4:
                                    c.push("");
                                    continue;
                                case 5:
                                    c.pop();
                                    continue;
                                case 6:
                                    c.push("6");
                                    continue;
                                case 7:
                                    c.push(n[a++]);
                                    continue;
                                case 8:
                                    var t = c[c.length - 1];
                                    continue;
                                case 9:
                                    c.length -= 15;
                                    continue;
                                case 10:
                                    c[c.length - 2] = c[c.length - 2][c[c.length - 1]];
                                    continue;
                                case 12:
                                    c[c.length - 16] = [c[c.length - 16], c[c.length - 15], c[c.length - 14], c[c.length - 13], c[c.length - 12], c[c.length - 11], c[c.length - 10], c[c.length - 9], c[c.length - 8], c[c.length - 7], c[c.length - 6], c[c.length - 5], c[c.length - 4], c[c.length - 3], c[c.length - 2], c[c.length - 1]];
                                    continue;
                                case 13:
                                    c.push("d");
                                    continue;
                                case 14:
                                    return;
                                case 15:
                                    c.push(e);
                                    continue;
                                case 16:
                                    c.push("b");
                                    continue;
                                case 17:
                                    c[c.length - 2] &= c[c.length - 1];
                                    continue;
                                case 18:
                                    c.push("f");
                                    continue;
                                case 20:
                                    c.push("a");
                                    continue;
                                case 21:
                                    c[c.length - 2] >>>= c[c.length - 1];
                                    continue;
                                case 23:
                                    c.push("4");
                                    continue;
                                case 24:
                                    c.push("9");
                                    continue;
                                case 27:
                                    var f = c[c.length - 1];
                                    continue;
                                case 28:
                                    c.push("2");
                                    continue;
                                case 29:
                                    c.push("3");
                                    continue;
                                case 31:
                                    c.push("7");
                                    continue;
                                case 34:
                                    c.push("8");
                                    continue;
                                case 35:
                                    c[c.length - 2] += c[c.length - 1];
                                    continue;
                                case 36:
                                    c.push("c");
                                    continue;
                                case 38:
                                    return c.pop();
                                case 39:
                                    c.push(f);
                                    continue;
                                case 42:
                                    c.push(t);
                                    continue;
                                case 43:
                                    c.push("1");
                            }
                        })["join"](""));
                    (f = {})["a1"] = Fc, f["a2"] = i, Wc || (Wc = zc["finger"].d()), f["a3"] = Wc, f["a4"] = D, f["a5"] = x, f["a6"] = y, f["a7"] = Xc, f["x0"] = 3, o = A >>> 0;
                    var T = f["a1"] + f["a2"] + f["a3"] + f["a4"] + o + v + f["a7"],
                        j = be["md5Array"](new Uint8Array(X(T))),
                        N = d << f["x0"] | d << 32 - f["x0"];
                    return j[0] ^= N, j[1] ^= o, j[2] = j[2] ^ o ^ N, j[3] ^= j[0], f["d1"] = be["md5ToHex"](j), f;
                    continue;
                case 1:
                    return;
            }
        }()) && (a = JSON["stringify"](d), c["header"]["mtgsig"] = a);
        try {
            d = 200, 0 === a["length"] && (d = 9401), _e && _e["addApi"]("dfp_sign_length", 200, d, a["length"], .001), _e && _e["addApi"]("dfp_sign", 200, d, Date["now"]() - f, .001);
        } catch (e) {
        }
    }
    return c;
}


function get_mtgsig(method, url, data, header) {
    Tc['openid'] = header['openId']
    data_info = {
        "timeout": 10000,
        "url": url,
        "isRequest": false,
        "data": data,
        "method": method,
        "dataType": "json",
        "withCredentials": false,
        "header": {
            "Content-Type": header['Content-Type'],
            "mt-token": header['mt-token'],
            "mt-lat": header['mt-lat'],
            "mt-lng": header['mt-lng'],
            "openId": header['openId'],
            "openIdCipher": header['openIdCipher'],
            "token": header['token'],
            "csecuuid": header['csecuuid'],
            "csecuserid": header['csecuserid'],
        }
    }
    return mtgsig(data_info, true)['header']['mtgsig']
}

function get_query(method, url, data, headers) {
    Tc['openid'] = headers['openId']
    data_info = {
        "url": url,
        "method": method,
        "data": data,
        "apiServiceConfig": {
            "commonRequestHandler": [
                null
            ],
            "commonResponseHandler": [
                null,
                null
            ],
            "domainMap": {
                "yapi": {
                    "online": "https://yapi.sankuai.com/thrift/mock/project/9737",
                    "st": "https://yapi.sankuai.com/thrift/mock/project/9737",
                    "qa": "https://yapi.sankuai.com/thrift/mock/project/9737",
                    "dev": "https://yapi.sankuai.com/thrift/mock/project/9737"
                },
                "mtunion": {
                    "online": "https://media.meituan.com",
                    "st": "https://media.st.meituan.com",
                    "qa": "http://media.test.meituan.com",
                    "dev": "http://media.test.meituan.com"
                },
                "pepper": {
                    "online": "https://peppermall.meituan.com",
                    "st": "https://peppermall.meituan.com",
                    "qa": "https://pepper.mall.test.sankuai.com",
                    "dev": "https://pepper.mall.test.sankuai.com"
                },
                "mars": {
                    "online": "https://mars.meituan.com",
                    "st": "https://mars.meituan.com",
                    "qa": "https://mars.meituan.com",
                    "dev": "https://mars.meituan.com"
                },
                "waimai": {
                    "online": "https://wx.waimai.meituan.com",
                    "st": "https://wx.waimai.st.meituan.com",
                    "qa": "https://wx.waimai.test.meituan.com",
                    "dev": "https://wx.waimai.dev.meituan.com"
                }
            },
            "swimLane": "",
            "env": "online",
            "requestHook": {}
        },
        "$config": {
            "url": "/mtunion/wxapp/queryMediaOrderList",
            "apiDesc": "订单-查询订单列表",
            "method": "POST",
            "header": {
                "content-type": "application/x-www-form-urlencoded"
            },
            "__env": "online"
        },
        "__onRequestSendPage": "pages/order/order",
        "__preRequestSendPage": "",
        "isRequest": true,
        "header": {
            "content-type": "application/x-www-form-urlencoded",
            "X-Requested-With": headers['X-Requested-With'],
            "x-env": headers['online'],
            "swimlane": headers['swimlane'],
            "geographyInfo": headers['geographyInfo'],
            "token": headers['token'],
            "csecuuid": headers['csecuuid'],
            "csecuserid": headers['csecuserid'],
            "openId": headers['openId'],
            "openIdCipher": headers['openIdCipher']
        }
    }

    return mtgsig(data_info, true)['header']['mtgsig']
}



// 美团订单返利信息查询函数
async function get_mt_order_rebate_info(orderViewId, token, userid, extraHeaders) {
    const req_time = Date.now();
    const url = "https://media.meituan.com/mtunion/wxapp/queryMediaOrderList?yodaReady=wx&csecappid=wxc32c3ddb81865d74&csecplatform=3&csecversionname=1.0.78&csecversion=1.3.0";

    extraHeaders = extraHeaders || {};
    const _csecuuid = extraHeaders.csecuuid || '1191923790926557190';
    const _openId = extraHeaders.openId || 'orY-a7aLYtlG5amc3ZQFjafo56gw';
    const _openIdCipher = extraHeaders.openIdCipher || 'AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADhweG0THr5LNdyBO+Gisc2mbCbJrsXzdmfwo+5zl4NgWOwGFy2MeqnvSnzMR5xq7J9wxQz+lXlamA==';

    const payload = `wm_actual_longitude=113.613319&wm_actual_latitude=34.748211&wm_longitude=113.613319&wm_latitude=34.748211&locatedCityId=73&cityId=73&orderViewId=${orderViewId}&consumeCityName=%E5%85%A8%E9%83%A8&cityName=%E5%85%A8%E9%83%A8&pageSize=20&settleType=1&tenantType=10&pageNum=0&status=0&wm_logintoken=${token}&userid=${userid}&userId=${userid}&user_id=${userid}&lch=0&wm_uuid_source=server&wm_uuid=${_csecuuid}&uuid=${_csecuuid}&unionid=oNQu9t8NB_8JXj78m2GynFJJsRTo&open_id=${_openId}&openid=${_openId}&wm_appversion=1.0.78&wm_visitid=d8854a1e-dcfd-4bd3-8ba7-0a472b71eddc&wm_dplatform=windows&wm_dversion=4.1.2.17&wm_dtype=microsoft&wm_ctype=mtunion_wxapp&req_time=${req_time}&waimai_sign=%2F`;

    const headers = {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Connection': 'keep-alive',
        'Referer': 'https://servicewechat.com/wxc32c3ddb81865d74/56/page-frame.html',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541211) XWEB/16815',
        'X-Requested-With': 'XMLHttpRequest',
        'csecuserid': userid.toString(),
        'csecuuid': _csecuuid,
        'geographyInfo': '%7B%7D',
        'openId': _openId,
        'openIdCipher': _openIdCipher,
        'swimlane': '',
        'token': token.toString(),
        'x-env': 'online',
        'xweb_xhr': '1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': 'media.meituan.com'
    };

    // 使用get_query生成签名
    const mtgsig = get_query("POST", url, payload, headers);
    headers['mtgsig'] = mtgsig;

    // 使用fetch发送请求（Node.js 18+支持原生fetch）
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: payload
        });

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('请求失败:', error);
        return {
            error: true,
            message: error.message
        };
    }
}

// ==================== 测试用例：peppermall branchList GET 接口 ====================
async function test_branchList() {
    const method = 'GET'
    const url = "https://peppermall.meituan.com/api/product/v2/1164825226/poi/branchList?_ver=4.70.11&platform=25&yodaReady=wx&csecappid=wxc32c3ddb81865d74&csecplatform=3&csecversionname=1.9.11&csecversion=1.3.0&offset=0&poiId=1972702567&poiIdEncrypt=qB4r17717fa509b89ee666a437925f71660ee8e63d7684a26106e19e732af42128d5c86f10a1daedb6be7d73642812e67d76bd1476dddd7145e8482d441c2637a1c719809bbc9166c62c2e40ea84d5e82fvxu5&poiCityId=603&limit=50&scpSource=30&cityId=603&userId=3614243158&lng=114.66382967618266&lat=35.17658710172985"
    const signHeaders = {
        "Content-Type": "application/json;Accept-Charset:utf-8;",
        "mt-token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "mt-lat": "35.17658710172985",
        "mt-lng": "114.66382967618266",
        "openId": "orY-a7aLYtlG5amc3ZQFjafo56gw",
        "openIdCipher": "AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADih5vr2alL+jxMG1/18o3fglvu1jUJQtHL3Fm7nYRXdeuXpjx8GVo6yRtaInEUOzINDXdjTqKQhFg==",
        "token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "csecuuid": "1191923790926557190",
        "csecuserid": "3614243158",
    }

    // 1. 生成 mtgsig
    const mtgsigValue = get_mtgsig(method, url, {}, signHeaders)
    console.log("===== 生成的 mtgsig =====")
    console.log(mtgsigValue)

    // 2. 使用生成的 mtgsig 发送实际请求
    const requestHeaders = {
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
        "Content-Type": "application/json;Accept-Charset:utf-8;",
        "Referer": "https://servicewechat.com/wxc32c3ddb81865d74/82/page-frame.html",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254171e) XWEB/18787",
        "csecuserid": "3614243158",
        "csecuuid": "1191923790926557190",
        "mt-lat": "35.17658710172985",
        "mt-lng": "114.66382967618266",
        "mt-token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "mtgsig": mtgsigValue,
        "openId": "orY-a7aLYtlG5amc3ZQFjafo56gw",
        "openIdCipher": "AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADih5vr2alL+jxMG1/18o3fglvu1jUJQtHL3Fm7nYRXdeuXpjx8GVo6yRtaInEUOzINDXdjTqKQhFg==",
        "token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "xweb_xhr": "1",
    }

    try {
        console.log("\n===== 发送请求中... =====")
        const response = await fetch(url, {
            method: 'GET',
            headers: requestHeaders,
        })
        const result = await response.json()
        console.log("===== 响应状态:", response.status, "=====")
        console.log("===== 响应内容 =====")
        console.log(JSON.stringify(result, null, 2))
    } catch (error) {
        console.error("===== 请求失败 =====")
        console.error(error.message)
    }
}

// ==================== 测试用例：peppermall branchInfo GET 接口 ====================
async function test_branchInfo() {
    const method = 'GET'
    const url = "https://peppermall.meituan.com/api/product/v2/1164825226/poi/branchInfo?_ver=4.70.11&platform=25&yodaReady=wx&csecappid=wxc32c3ddb81865d74&csecplatform=3&csecversionname=1.9.11&csecversion=1.3.0&poiId=1972702567&poiIdEncrypt=qB4r17717fa509b89ee666a437925f71660ee8e63d7684a26106e19e732af42128d5c86f10a1daedb6be7d73642812e67d76bd1476dddd7145e8482d441c2637a1c719809bbc9166c62c2e40ea84d5e82fvxu5&cityId=603&userId=3614243158&lng=114.66382967618266&lat=35.17658710172985"
    const signHeaders = {
        "Content-Type": "application/json;Accept-Charset:utf-8;",
        "mt-token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "mt-lat": "35.17658710172985",
        "mt-lng": "114.66382967618266",
        "openId": "orY-a7aLYtlG5amc3ZQFjafo56gw",
        "openIdCipher": "AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADih5vr2alL+jxMG1/18o3fglvu1jUJQtHL3Fm7nYRXdeuXpjx8GVo6yRtaInEUOzINDXdjTqKQhFg==",
        "token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "csecuuid": "1191923790926557190",
        "csecuserid": "3614243158",
    }

    // 1. 生成 mtgsig
    const mtgsigValue = get_mtgsig(method, url, {}, signHeaders)
    console.log("\n\n===== [branchInfo] 生成的 mtgsig =====")
    console.log(mtgsigValue)

    // 2. 使用生成的 mtgsig 发送实际请求
    const requestHeaders = {
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
        "Content-Type": "application/json;Accept-Charset:utf-8;",
        "Referer": "https://servicewechat.com/wxc32c3ddb81865d74/82/page-frame.html",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254171e) XWEB/18787",
        "csecuserid": "3614243158",
        "csecuuid": "1191923790926557190",
        "mt-lat": "35.17658710172985",
        "mt-lng": "114.66382967618266",
        "mt-token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "mtgsig": mtgsigValue,
        "openId": "orY-a7aLYtlG5amc3ZQFjafo56gw",
        "openIdCipher": "AwQAAABJAgAAAAEAAAAyAAAAPLgC95WH3MyqngAoyM/hf1hEoKrGdo0pJ5DI44e1wGF9AT3PH7Wes03actC2n/GVnwfURonD78PewMUppAAAADih5vr2alL+jxMG1/18o3fglvu1jUJQtHL3Fm7nYRXdeuXpjx8GVo6yRtaInEUOzINDXdjTqKQhFg==",
        "token": "AgFgIJSeO_kUUbwp4eLIawZqRsOAI0bn1r86oc9KyyNkCQXoJWnBKgcPsrCOQzSoLelB4IW9pwATcAAAAACnLgAAGuCUHE8_ejqrm8vHh-2n9o7RHxnsVYFqPI9pBBxPwKdOFTNvvQRZXLAJplw73-n8",
        "xweb_xhr": "1",
    }

    try {
        console.log("\n===== [branchInfo] 发送请求中... =====")
        const response = await fetch(url, {
            method: 'GET',
            headers: requestHeaders,
        })
        const result = await response.json()
        console.log("===== [branchInfo] 响应状态:", response.status, "=====")
        console.log("===== [branchInfo] 响应内容 =====")
        // console.log(JSON.stringify(result, null, 2))
    } catch (error) {
        console.error("===== [branchInfo] 请求失败 =====")
        console.error(error.message)
    }
}

// 依次执行两个测试
async function runTests() {
    await test_branchList()
    await test_branchInfo()
}
runTests()
