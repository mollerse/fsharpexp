(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
(function (Buffer){


var slides = Buffer("PHN0eWxlPgoKICAqIHsKICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7CiAgfQoKICAubGlnaHQgewogICAgYmFja2dyb3VuZDogI2U0ZWJlZTsKICAgIGNvbG9yOiAjMWMyMDJiOwogIH0KCiAgLmVtcGhhc2lzIHsKICAgIGJhY2tncm91bmQ6ICNmYjU0NGQ7CiAgICBjb2xvcjogI2ZmZjsKICB9CgogIC5lbXBoYXNpcyBoMSwKICAuZW1waGFzaXMgaDIsCiAgLmVtcGhhc2lzIGgzLAogIC5lbXBoYXNpcyBoNCB7CiAgICBjb2xvcjogIzFjMjAyYjsKICB9CgogIC5saWdodCBoMSwKICAubGlnaHQgaDIsCiAgLmxpZ2h0IGgzLAogIC5saWdodCBoNCB7CiAgICBjb2xvcjogIzFjMjAyYjsKICB9CgogIC5kYXJrIHsKICAgIGJhY2tncm91bmQ6ICMxYzIwMmI7CiAgfQoKICAucmV2ZWFsIC5zdWJ0aXRsZSB7CiAgICBmb250LWZhbWlseTogJ0phYXBva2tpLXJlZ3VsYXInLCBzYW5zLXNlcmlmOwogIH0KCiAgLnNsaWRlcz5zZWN0aW9uIHsKICAgIHBhZGRpbmc6IDElICFpbXBvcnRhbnQ7CiAgfQoKICAubWlkdGVuIHsKICAgIGhlaWdodDogMTAwJTsKICAgIGRpc3BsYXk6IGZsZXggIWltcG9ydGFudDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICB9CgogIC5taWR0ZW4gPiAqIHsKICAgIHRleHQtYWxpZ246IGNlbnRlciAhaW1wb3J0YW50OwogIH0KCiAgaDEsIGgyLCBoMywgaDQgewogICAgdGV4dC1hbGlnbjogbGVmdDsKICB9CgogIC5yZXZlYWwgcCB7CiAgICBmb250LXNpemU6IDE1MCU7CiAgICB0ZXh0LWFsaWduOiBsZWZ0OwogIH0KICBzcGFuLnV0aGV2IHsKICAgIGNvbG9yOiAjZmI1NDRkOwogIH0KCiAgaW1nIHsKICAgIGJvcmRlcjogbm9uZSAhaW1wb3J0YW50OwogICAgYmFja2dyb3VuZDogaW5oZXJpdCAhaW1wb3J0YW50OwogICAgYm94LXNoYWRvdzogbm9uZSAhaW1wb3J0YW50OwogIH0KCiAgLnN0cmlrZS52aXNpYmxlOm5vdCguY3VycmVudC1mcmFnbWVudCkgewogICAgdGV4dC1kZWNvcmF0aW9uOiBsaW5lLXRocm91Z2g7CiAgfQoKPC9zdHlsZT4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMj5FTiBGIyBUUk9KQU5TSyBIRVNUPC9oMj4KICA8aDI+Jm1kYXNoOzwvaDI+CiAgPGgzPkVyZmFyaW5nZXIgZnJhIGJydWtlbiBhdiBldCBGIy1kb21lbmUgaSBlbiBDIy1rb250ZWtzdDwvaDM+CiAgPGg3PlN0aWFuIFZldW0gTcO4bGxlcnNlbiAvIEBtb2xsZXJzZTwvaDc+CiAgPGg3PkJFS0s8L2g3Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibGlnaHQgbWlkdGVuIiBkYXRhLWJhY2tncm91bmQ9ImU0ZWJlZSI+CiAgPGgyPktPTlRFS1NUPC9oMj4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBWaSBzdGFydGVyIG1lZCBsaXR0IGJha2dydW5uIGZvciBwcm9zamVrdGV0IGZvciDDpSBldGFibGVyZSBrb250ZWtzdGVuIGZvciBkZQp0aW5nZW5lIGplZyBrb21tZXIgdGlsIMOlIHNuYWtrZSBvbSBzZW5lcmUuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgzPlByb2JsZW1zdGlsbGluZ2VuPC9oMz4KICA8cD4KICAgIEZvcmJlZHJlIGtvbW11bmlrYXNqb24gbWVsbG9tIGxlZ2UsIHN5a2VodXMgb2cgcGFzaWVudCBnamVubm9tIMOlIHRpbGJ5IHZlcmt0w7h5Cm1lZCBiZWRyZSBnamVuZ2l2ZWxzZS0gb2cgYW5hbHlzZS1tdWxpZ2hldGVyLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBEZXQgdmFyIGxpdHQgYXYgZW4gbXVubmZ1bGwuIEh2aXMgdmkgdXR2aWRlciBsaXR0IHPDpSBiZXR5ciBkZXR0ZSBhdCB2ZWt0ZW4KbGlnZ2VyIHDDpSDDpSBsYSBwYXNpZW50ZW5lIGdpIG1lciBuw7h5YWt0aWcgaW5mb3JtYXNqb24gdmVkIMOlIGdpIGRlIGdvZGUKZ3JlbnNlc25pdHQgZm9yIGluZm9ybWFzam9uc2hlbnRpbmcgZm9yIHPDpSDDpSBnasO4cmUgYW5hbHlzZSBvZyBmb3JlZGxpbmcgYXYgZGVubmUKaW5mb3JtYXNqb25lbiBmb3IgbGVnZW4gb2cgc3lrZWh1c2V0LgogICAgPC9wPgogICAgPHA+CiAgICAgIEhvdmVkLWVudGl0ZXRlbiBpIHN5c3RlbWV0IGVyIGV0IHNldHQgbWVkIHNww7hyc23DpWwgcGFzaWVudGVyIHNrYWwgc3ZhcmUgcMOlCmdqZW5ub20gc3lrZWh1cy1vcHBob2xkZXQuIERpc3NlIHNww7hyc23DpWxlbmUgc2FtbGVzIGlubiBnamVubm9tIGV0IGdyZW5zZXNuaXR0CnNvbSBrasO4cmVyIGkgYnJvd3NlcmVuIHDDpSB0YWJsZXRzIGVsbGVyIGhqZW1tZSBww6UgcGFzaWVudGVucyBQQy4gRGlzc2Ugc3ZhcmVuZQpibGlyIHPDpSBhbmFseXNlcnQgb2cgYmVoYW5kbGV0IG9nIHByZXNlbnRlcnQgZm9yIGxlZ2VuZSBww6UgbcOldGVyIHNvbSBza2FsIGdpCm1ha3NpbWFsdCBtZWQgc3TDuHR0ZSBmb3IgYmVzbHV0bmluZ2VuZSBsZWdlbmUgdGFyIHZlZHLDuHJlbmRlIHBhc2llbnRlbi4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+UHJvc2pla3RldDwvaDM+CiAgPHA+CiAgICBIZXRlciBFaXIuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIFN0YXJ0dXAtaXNoIHNpdHVhc2pvbiBtZWQgZXQgbGl0ZSB0ZWFtLCBow7h5IGxldmVyaW5nc2ZyZWt2ZW5zIG9nIGbDpSB0ZWtuaXNrZQpyZXR0bmluZ3NsaW5qZXIuCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFNldHRpbmdlbiBmb3IgcHJvc2pla3RldCBlciBlbiBzbGFncyBzdGFydHVwLiBEZXQgZXIgZXQgbGl0ZSBmaXJtYSBzb20gaGFyCnV0c3ByaW5nIGZyYSBOVE5VcyBpbmt1YmF0b3IgVGVjaG5vbG9neSBUcmFuc2ZlciBPZmZpY2UgKFRUTykuIFRUTyBoamVscGVyCmFuc2F0dGUgb2cgc3R1ZGVudGVyIHZlZCBOVE5VIG1lZCDDpSByZWFsaXNlcmUgaWRlZW5lIHNpbmUuIEZvciDDpSBrbGFyZSDDpQpyZWFsaXNlcmUgYWtrdXJhdCBkZW5uZSBpZGVlbiBoYXIgZGUgZW5nYXNqZXJ0IGV0IHRlYW0gZnJhIEJFS0tzClRyb25kaGVpbXMta29udG9yLCBodm9yIGplZyBqb2JiZXQgZnJlbSB0aWwgamVnIGZseXR0YSB0aWwgT3NsbyBuw6UgaSBzb21tZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgU2lkZW4gcHJvc2pla3RldCBlciBpIGVuIG9wcHN0YXJ0c2Zhc2UgaHZvciBsaXRlIGVyIGh1Z2QgaSBzdGVpbiBoYXIgZGV0IHbDpnJ0CnZpa3RpZyDDpSBrdW5uZSByZWFsaXNlcmUgZnVua3Nqb25hbGl0ZXQgc8OlIHRpZGxpZyBzb20gbXVsaWcgZm9yIMOlIGdqZW5ub21mw7hyZQpicnVrZXJ0ZXN0aW5nLiBEZXR0ZSBmw7hydGUgdGlsIGF0IHZpIHNvbSB1dHZpa2xlcmUgZmlrayBmcmllIHTDuHlsZXIgdGlsIMOlIHZlbGdlCnRla25vbG9naSBzb20gaGphbHAgb3NzIG1lZCBkZXR0ZS4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+VGVhbWV0PC9oMz4KICA8cD4KICAgIExpdGUsIG1lZCBzdG9yIHZhcmlhc2pvbiBpIGJha2dydW5uIG9nIGVyZmFyaW5nLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBWaSBoYXIgdsOmcnQgZW4gbGl0ZSB0ZWFtLiBUZWFtZXQgaGFyIHN0b3J0IHNldHQgYWxkcmkgdsOmcnQgbWVyIGVubiAzCnV0dmlrbGVyZSBvZyBlbiBpbnRlcmFrc2pvbnNkZXNpZ25lciBww6UgZW4gZ2FuZy4gT2cgaSBlbmtlbHRlIGZhc2VyIHbDpnJ0IG5lZGUgaQprdW4gZW4gZnVsbHRpZHMtdXR2aWtsZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgQmFrZ3J1bm5lbiB0aWwgdXR2aWtsZXJuZSBzb20gaGFyIHbDpnJ0IGlubm9tIHByb3NqZWt0ZXQgaGFyIHbDpnJ0IGdhbnNrZSB1bGlrLAptZW4gZmVsbGVzIGhhciB2w6ZydCBhdCBhbGxlIHV0dmlrbGVybmUgc29tIGhhciB2w6ZydCBpbm5vbSBoYXIgdsOmcnQgbW90aXZlcnRlIG9nCm55c2tqZXJyaWdlLiBUYSBtZWcgc2VsdiBmZWtzLiBFcmZhcmVuIGZyb250ZW5kLXV0dmlrbGVyLCBtZWQgZW4gZm9ya2plcmxpZ2hldApmb3IgZnVua3Nqb25lbGwgcHJvZ3JhbW1lcmluZyBpIEphdmFTY3JpcHQuCiAgICA8L3A+CiAgICA8cD4KICAgICAgTWVkIHVubnRhayBhdiBwZXJzb25lbiBzb20gaW50cm9kdXNlcnRlIEYjIHDDpSBwcm9zamVrdGV0IGhhciBpbmdlbiBhdgp0ZWFtbWVkbGVtbWVuZSBoYXR0IG5vZSBzw6ZybGlnIGVyZmFyaW5nIG1lZCBGIyAoZWxsZXIgYW5kcmUgTUwtZGlhbGVrdGVyKS4KICAgIDwvcD4KICAgIDxwPgogICAgICBEZXQgZXIgb2dzw6UgdmVyZHQgw6UgbmV2bmUgYXQgZGV0IGkgYWx0IGhhciB2w6ZydCA4IHVsaWtlIHV0dmlrbGVyZSBpbm5vbQpwcm9zamVrdGV0LgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMz5EcmlmdHNpdHVhc2pvbjwvaDM+CiAgPHA+CiAgICBTa2FsIGRyaWZ0ZXMgb24tcHJlbWlzZSBhdiBzeWtlaHVzZW5lIHNlbHYuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIEhhciB2w6ZydCBpIHRlc3QtcHJvZCBww6UgQXp1cmUgaSBjYSAxLjUgw6VyLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBQbGFuZW4gZXIgYXQgZGV0dGUgc3lzdGVtZXQgc2thbCBkcmlmdGVzIG9uIHByZW1pc2UgYXYgc3lrZWh1c2V0cyBlZ25lCklULWF2ZGVsaW5nZXIuIERldHRlIGVyIHBnYSBkaXZlcnNlIGxvdmVyIG9nIHJlZ2xlciBmb3IgaMOlbmR0ZXJpbmcgYXYgc2Vuc2l0aXZlCmRhdGEsIHNvbSBkZXQgZm9ydCBibGlyIG7DpXIgZW4gZHJpdmVyIG1lZCBwYXNpZW50ZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgU3lzdGVtZXQgaGFyIHbDpnJ0IGkgZW4gcHJvZC1saWtlIHRpbHN0YW5kIHDDpSBBenVyZSBpIGNhIDEuNSDDpXIgbsOlLCBtZWQgYWt0aXYKYnJ1ayBpIHRlc3Qgb2cgZm9yc2tuaW5nLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4gbGlnaHQiIGRhdGEtYmFja2dyb3VuZD0iZTRlYmVlIj4KICA8aDI+VEVLTklTSyBLT05URUtTVDwvaDI+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgTsOlIHNvbSB2aSBoYXIgbGl0dCBiYWtncnVubiBmb3IgcHJvc2pla3RldCwgbGEgb3NzIHRhIGVuIGxpdGVuIHRpdHQgcMOlIGRlbgp0ZWtuaXNrZSBpbXBsZW1lbnRhc2pvbmVuIGF2IHN5c3RlbWV0LiBNZWQgbWluIGVnZW4gYmFrZ3J1bm4gb2cgcHJvc2pla3RldHMKc3TDuHJyZWxzZSB0YXR0IGkgYmV0cmFrdG5pbmcga29tbWVyIGplZyBpa2tlIHRpbCDDpSBnw6UgdmVsZGlnIG7DuHllIGlubiBww6UgZGUKdGVrbmlza2UgYXNwZWt0ZW5lIGF2IGzDuHNuaW5nZW4sIGRldCB2aWxsZSB2w6ZydCBsaXR0IHByZWFjaGluZyB0byB0aGUgY2hvaXIgb2cKamVnIGVyIHNpa2tlciBww6UgYXQgZGVyZSBpIHB1Ymxpa3VtIGhhciBiZWRyZSBrb250cm9sbCBww6UgZGUgZm9yc2tqZWxsaWdlCmFzcGVrdGVuZSB2ZWQgRiMgZW5uIGplZyBoYXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgTcOlbGV0IG1lZCBkZW5uZSBkZWxlbiBhdiBwcmVzZW50YXNqb25lbiBlciBlZ2VudGxpZyDDpSBzZXR0ZSBlcmZhcmluZ2VuZSBvZwpnZXZpbnN0ZW5lIGkgZW4gdGVrbmlzayBrb250ZWtzdC4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+QXJraXRla3R1cjwvaDM+CiAgPHA+CiAgICBLbGFzc2lzayBjbGllbnQtc2VydmVyLgogIDwvcD4KICA8YnI+CiAgPHA+CiAgICBJIGRhZyBiZXN0w6VyIHN5c3RlbWV0IGF2IHRyZSBjbGllbnQtc2VydmVyLXBhciBtZWQgZmVsbGVzIGRhdGFsYWdlci4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRW4gZ2Fuc2tlIHN0YW5kYXJkIGNsaWVudC1zZXJ2ZXIgaW1wbGVtZW50YXNqb24uIERldCBlciBsaXRlIGtvbXBsZWtzaXRldCBpIGZvcm0KYXYgbWlrcm90amVuZXN0ZXIgZWxsZXIgYW5kcmUgc3lzdGVtLW5pdsOlIHV0Zm9yZHJpbmdlci4gQmFyZSBlbiBzdHJhaWdodCB1cCAuTkVUCnNlcnZlciBzb20gdGFyIGltb3Qgbm9lIGRhdGEsIGJlaGFuZGxlciBkZXQgb2cgbGFncmVyIGRldCBpIGVuIGRhdGFiYXNlLgogICAgPC9wPgogICAgPHA+CiAgICAgIFRpbCBuw6UgaGFyIHZpIHN0eXJ0IHVubmEgYWxsIGludGVncmFzam9uIG1lZCBhbmRyZSBzeXN0ZW1lciBob3Mgc3lrZWh1c2VuZSBlbGxlcgozLnBhcnRzIHRqZW5lc3RlciB1bmRlciBrasO4cmluZy4gVmkgYmVueXR0ZXIgb3NzIGF2IGdvb2dsZSBkb2NzIGZvciBlbiBkZWwgYXYgZGUKcmVkYWt0w7hyc3R5cnRlIGRhdGFlbmUuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgzPkFya2l0ZWt0dXIgLSBTZXJ2ZXI8L2gzPgogIDxwPgogICAgRW4gLk5FVC1sw7hzbmluZy4gRXQgcGFyIHR5bm5lIEMjIGxhZyBmb3Igw6Uga29tbXVuaXNlcmUgbWVkIGNsaWVudCBvZyBkYXRhYmFzZQooTVNTUUwpLiBBbGwgZG9tZW5lbG9naWtrIGkgRiMuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIEhvdmVkb3BwZ2F2ZSBlciBiZWhhbmRsaW5nIG9nIHRyYW5zZm9ybWFzam9uIGF2IGRhdGEuCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFNlcnZlcmVuIGVyIGltcGxlbWVudGVydCBtZWQga3VuIGV0IHR5bnQgbGFnIGF2IEMjIGNvbnRyb2xsZXJlIG92ZXIgZW4ga2plcm5lIGF2CkYjLiBEZXQgZXIgb2dzw6UgbGl0dCBDIyBmb3Igw6Uga29tbXVuaXNlcmUgbWVkIGRhdGFiYXNlbiAoTVNTUUwpLgogICAgPC9wPgogICAgPHA+CiAgICAgIFZpIGhhciBvZ3PDpSBlbiBsaXRlbiBGIy1tb2R1bCBzb20gbGFyIG9zcyBrb21tdW5pc2VyZSBtZWQgZ29vZ2xlIGRvY3MuIERlbm5lCmtvbW11bmlrYXNqb25lbiBza2plciBob3ZlZHNha2xpZyBidWlsZHRpbWUgZm9yIMOlIGhlbnRlIHN0YXRpc2tlIGRhdGEgZnJhIGdvb2dsZQpkb2NzLiBEZXQgZmlubmVzIGV0IGZvcmVkcmFnIGZyYSBTbWlkaWcgMjAxMyBhdiBKb25hcyBGb2xsZXPDuCBvbSBha2t1cmF0IGRlbm5lCmzDuHNuaW5nZW4sIGFuYmVmYWxlcyBodmlzIG5vZW4gdHJlbmdlciBlbiAgTVZQIGZvciByZWRha3TDuHJzdHlydGUgZGF0YS4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+QXJraXRla3R1ciAtIENsaWVudDwvaDM+CiAgPHA+CiAgICBFbiBSZWFjdC5qcyBsw7hzbmluZy4gVHlrayBKUy1hcHBsaWthc2pvbiBzb20gZXIgZHJldmV0IGF2IGRhdGFlbmUgZnJhIHNlcnZlcmVuLgogIDwvcD4KICA8YnI+CiAgPHA+CiAgICBIZXIgZXIgbWVzdGVwYXJ0ZW4gYXYga29tcGxla3NpdGV0ZW4gaSBzeXN0ZW1ldC4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRm9yIGtvbXBsZXR0aGV0ZW5zIHNreWxkIHPDpSBrYW4gdmkgdGEgZW4gbGl0ZW4gdHVyIGlubm9tIHdlYi1jbGllbnRlbiB0aWwKc3lzdGVtZXQuIERldHRlIGVyIGVuIEpTLWFwcCBpbXBsZW1lbnRlcnQgaSBSZWFjdC5qcyBtZWQgc3TDuHR0ZSBmcmEKSW1tdXRhYmxlLmpzLiBEZXQgZXIgZWdlbnRsaWcgaGVyIG1lc3RlcGFydGVuIGF2IGtvbXBsZWtzaXRldGVuIHRpbCBzeXN0ZW1ldApsaWdnZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgS2xpZW50ZW4gYmxpciBkcmV2ZXQgYXYgZW4gc3RvciBkYXRhc3RydWt0dXIgZGVuIG1vdHRhciBmcmEgc2VydmVyZW4gdmVkIGxvYWQuCkRldCBlciBkYSBvcHAgdGlsIGtsaWVudGVuIMOlIG5hdmlnZXJlIGdqZW5ub20gZGVubmUgc3RydWt0dXJlbiBvZyBwb3N0ZQpvcHBkYXRlcmluZ2VyIHRpbGJha2UgdGlsIHNlcnZlcmVuLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMz5GIyBpIEMjLWxhbmQ8L2gzPgogIDxwPgogICAgRiMga29kZW4gbGV2ZXIgaSBlZ25lIHByb3NqZWt0ZXIgc29tIGJsaXIgaW5rbHVkZXJ0IHNvbSByZWZlcmVydGUgYmluYXJpZXMuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIEFsdCBlciBlbiBkZWwgYXYgc2FtbWUgc29sdXRpb24uCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIMOFIGtvbWJpbmVyZSBGIyBvZyBDIyBlciBnYW5za2UgcmV0dCBmcmVtLCBzb20gZGUgZmxlc3RlIGF2IGRlcmUgc2lra2VydCBoYXIKdGVzdGEgdXQuIEMjIGthbiBoYSByZWZlcmFuc2VyIHRpbCBrb21waWxlcnRlIEYjLWJpbmFyaWVzLCBzb20gZnVuZ2VyZXIgYWtrdXJhdApzb20gQyMgYmluYXJpZXMuCiAgICA8L3A+CiAgICA8cD4KICAgICAgRGV0dGUga29ua2x1ZGVyZXIgZGV0IGplZyBoYWRkZSB0ZW5rdCDDpSBzaSBvbSB0ZWtuaXNrZSBkZXRhbGplci4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIGxpZ2h0IiBkYXRhLWJhY2tncm91bmQ9ImU0ZWJlZSI+CiAgPGgyPkdFVklOU1RFUiAmYW1wOyBFUkZBUklOR0VSPC9oMj4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBEZXR0ZSBlciBrYW5za2plIGRldCBvbXLDpWRldCBodm9yIGRldHRlIHByb3NqZWt0ZXQgaGFyIG1lc3Qgw6UgYmlkcmEgbWVkIHRpbGJha2UKdGlsIGNvbW11bml0eWVuLiBEZXQgZmlubmVzIG1lciBpbnRlcmVzc2FudGUgdGVrbmlza2UgY2FzZS1zdHVkaWVzIGZvciBGIywgbWVuCmRldCB2aSBkZXJpbW90IGhhciwgc29tIGVyIGludGVyZXNzYW50IMOlIHNlIHDDpSwgZXIgaHZvcmRhbiB0ZWtub2xvZ2l2YWxnZXQgaGFyCmZ1bmdlcnQgaSBmb3Job2xkIGRlbiBrb250ZWtzdGVuIHByb3NqZWt0ZXQgaGFyIGJlZnVubmV0IHNlZyBpLgogICAgPC9wPgogICAgPHA+CiAgICAgIFByb3NqZWt0ZXQgaGFyIHRlc3RhIHV0IGh2b3J2aWR0IEYjIGZ1bmdlcmVyIHNvbSBldCBzcHLDpWt2YWxnIGZvcgp1dHZpa2xlcmUgZnJhIG1hbmdlIGZvcnNramVsbGlnZSBiYWtncnVubmVyIG9nIGVyZmFyaW5nc25pdsOlZXIuIE1hbmdlIGVuZHJpbmdlcgpvZyBow7h5IGxldmVyaW5nc2hhc3RpZ2hldCBnasO4ciBhdCBmbGVrc2liaWxpdGV0ZW4gdGlsIHNwcsOla2V0IHZpcmtlbGlnIGbDpXIga2rDuHJ0CnNlZy4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+RGF0YXRyYW5zZm9ybWFzam9uPC9oMz4KICA8cD4KICAgIEhvdmVkb3BwZ2F2ZW4gdGlsIHNlcnZlcmVuIGVyIMOlIHRyYW5zZm9ybWVyZSBkYXRhLgogIDwvcD4KICA8YnI+CiAgPHA+CiAgICBGdW5rc2pvbmVsbCBwcm9ncmFtbWVyaW5nIGVyIGVuIHZlbGRpZyBnb2QgZml0IGZvciBkYXRhdHJhbnNmb3JtYXNqb24uCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIMOFIGhhIGV0IGZ1bmtzam9uZWxsdCBzcHLDpWsgdGlsZ2plbmdlbGlnIG7DpXIgZGF0YXRyYW5zZm9ybWFzam9uIGVyIGhvdmVkb3BwZ2F2ZW4KZXIgdmVsZGlnIGtyYWZ0aWcuIEJlaGFuZGxlIGRhdGEgc29tIGRhdGEsIG9nIGlra2Ugc29tIHRpbHN0YW5kc2Z1bGxlIGVudGl0ZXRlcgptZWQgZWdlbnNrYXBlciwgZXIgZW4gbXllIG1lciBuYXR1cmxpZyBtw6V0ZSDDpSB0ZW5rZSBvZyBqb2JiZSBww6UuCiAgICA8L3A+CiAgICA8cD4KICAgICAgSHZpcyBkZXQgZXIgZW4gdGluZyBqZWcgdmlsIGRyYSBmcmVtIHNvbSBldCBwcmltYSBla3NlbXBlbCBww6UgaHZvcmRhbiBkdSBrYW4Kc25pa2UgaW5uIEYjIGkgZXQgcHJvc2pla3Qgc8OlIGVyIGRldCBkZW5uZSB0eXBlbiBvcHBnYXZlLiBPZyBkZXQgZXIgbmV0dG9wcApkZXR0ZSBzb20gc2tqZWRkZSBww6UgdsOlcnQgcHJvc2pla3QuIFZpIGhhZGRlIGJlaG92IGZvciDDpSBwYXJzZSBkYXRhIGkgZXQKc3ByZWFkc2hlZXQgb2cgw6UgaW1wbGVtZW50ZXJlIGRldCBpIEYjIHZpcmthIHNvbSBkZXQgbmF0dXJsaWdlIHZhbGdldC4KICAgIDwvcD4KICAgIDxwPgogICAgICBGIyBoYXIgbWFuZ2UgZWdlbnNrYXBlciBzb20gZ2rDuHIgZGV0IHNwZXNpZWx0IGdvZHQgZWduYSBmb3Igw6Ugam9iYmUgbWVkIGRhdGEuClBhdHRlcm4tbWF0Y2hpbmcgb2cgcGlwZWxpbmVzIGVyIGVrc2VtcGxlciwgbWVuIGRlbiBhbGxlciBiZXN0ZSB0aW5nZW4gZXIuLi4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+VHlwZXN5c3RlbTwvaDM+CiAgPHA+CiAgICBGIyBoYXIgZXQgdXRyb2xpZyBmbGVrc2liZWx0IG9nIHV0dHJ5a2tzZnVsbHQgdHlwZXN5c3RlbS4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgSmVnIHRyZW5nZXIgdmVsIGVnZW50bGlnIGlra2Ugw6UgZm9ya2xhcmUgYWxsZSBmb3JkZWxlbmUgbWVkIGRlbiB0eXBlbiB0eXBlc3lzdGVtCnNvbSBGIyBoYXIsIGlra2UgYXQgamVnIGhhZGRlIGtsYXJ0IGRldCBoZWxsZXIuIE1lbiBkZXQgamVnIGthbiBzaSBub2Ugb20gZXIKaHZvcmRhbiBkZXR0ZSB0eXBlc3lzdGVtZXQgYmxlIG9wcGxldmQgYXYgZW4gZnJvbnRlbmR1dHZpa2xlci4KICAgIDwvcD4KICAgIDxwPgogICAgICBKZWcgaGFyIHNrcmV2ZXQgYsOlZGUgSmF2YSBvZyBDIyBwcm9mZXNqb25lbHQsIG9nIGkgYmVnZ2UgdGlsZmVsbGVuZSBmw7hsdGUgamVnIGF0CnR5cGUtaW5mb3JtYXNqb25lbiB2YXIgbWVyIGkgdmVpZW4gZW5uIHRpbCBueXR0ZS4gRGV0IHZhciB0dW5ndmludCDDpSBkZWZpbmllcmUKdHlwZXIgb2cgZGV0IHZhciB0dW5ndmludCDDpSBrb21wb25lcmUgdHlwZXIuIEhhZGRlIHN0b3J0IHNldHQgZ2l0dCBvcHAgc3RhdGlzawp0eXBhIHNwcsOlayBvZyBvbWZhdm5hIEphdmFTY3JpcHRzIGR5bmFtaXNrZSBuYXR1ciBmw7hyIGplZyBmaWtrIG11bGlnaGV0ZW4gdGlsIMOlCnNrcml2ZSBsaXR0IEYjLgogICAgPC9wPgogICAgPHA+CiAgICAgIEtvbWJpbmFzam9uZW4gYXYgZGF0YWJlaGFuZGxpbmdzZXZuZW5lIG9nIHR5cGVkZWZpbmlzam9uZXIgbWVuZXIgamVnIGVyIGRlbgpzdMO4cnN0ZSBmb3JkZWxlbiBtZWQgw6UgaGEgRiMgaSB2ZXJrdMO4eWthc3NhLiBEZXQgbG90IG9zcyBnasO4cmUgZW5kcmluZ2VyIHDDpQpsb2dpa2sgb2cgc3RydWt0dXIgdXRlbiDDpSBmcnlrdGUgZm9yIGJ1Z3MuIERldHRlIGVyIGRldCBqZWcgdmlsIGRyYSBmcmVtIHNvbQpncnVubmVuIHRpbCBhdCBqZWcgZsO4bGVyIG1lZyB0cnlnZyBww6UgYXQgRiMgdmFyIGV0IHJldHQgdmFsZyBpIHbDpXJ0IHByb3NqZWt0IG10cAp2ZXJkaSBsZXZlcnQgdGlsIGt1bmRlIG9nIHNsdXR0YnJ1a2VyLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMz5PbmJvYXJkaW5nPC9oMz4KICA8cD4KICAgIEYjIGVyIGdhbnNrZSBncmVpdCDDpSBrb21tZSBpZ2FuZyBtZWQuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIFV0Zm9yZHJpbmdlbmUgc3RhbW1lciBpIGhvdmVkc2FrIGZyYSBvdmVyZ2FuZ2VuIGZyYSBpbXBlcmF0aXYvT09QIHRpbCBGUC4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgw5hrb3N5c3RlbWV0IHJ1bmR0IEYjIGVyIGkgc3RvciBncmFkIGRldCBzYW1tZSBzb20gZm9yIEMjLiBEdSBoYXIgVlMsIE51R0VULApNU0JVSUxEIGV0Yy4gRGV0IHZhciBsaXRlIG55dHQgaGVyIG7DpXIgcHJvc2pla3RldCBhbGxlcmVkZSBoYXIgZXQgb3Bwc2V0dCBmb3IgZXQKLk5FVCBwcm9zamVrdC4KICAgIDwvcD4KICAgIDxwPgogICAgICBGb3IgZGUgYXYgb3NzIHNvbSBoYWRkZSBlcmZhcmluZyBtZWQgRlAgZnJhIGbDuHIgYXYgdmFyIEYjIGdhbnNrZSBncmVpdCDDpSBrb21tZQppZ2FuZyBtZWQuIERlIHNvbSBpa2tlIGhhZGRlIGRlbiBlcmZhcmluZ2VuIGkgYmFrZ3J1bm5lbiBzaW4gaGFkZGUgbGl0dCBtZXIKdHLDuGJiZWwgbWVkIMOlIGtvbW1lIGlnYW5nLiBLb21iaW5hc2pvbmVuIGF2IG55IHN5bnRheCBvZyBueXR0IHBhcmFkaWdtZSBrYW4gYmxpCmkgb3ZlcmthbnQgdm9sZHNvbXQuIERldHRlIGVyIHZlcmR0IMOlIGhhIGkgYmFraG9kZXQgbsOlciBGIyBza2FsIGJydWtlcywgYnJ1awpsaXR0IHRpZCBww6Ugw6UgbMOmcmUgZnVua3Nqb25lbGwgcHJvZ3JhbWVyaW5nIHNlcGFyYXQgZnJhIEYjIGbDuHJzdC4KICAgIDwvcD4KICAgIDxwPgogICAgICBUeXBlZGVmaW5pc2pvbnNoaWVyYXJraWV0IGdpciBkZWcgdW1pZGRlbGJhciBvdmVyc2lrdCBvdmVyIGRvbWVuZXQgdXRlbiDDpQp1dGZvcmRyZSBkZWcgbmV2bmV2ZXJkaWcgcMOlIHN5bnRheC4gRGV0IHZhciBtZWQgcMOlIMOlIGdqw7hyZSBvbi1ib2FyZGluZyBtZXIKc21pZGlnLiBFbiBueSBwcm9ncmFtbWVyZXIga3VubmUgc2l0dGUgbWVkIHR5cGVkZWZpbmlzam9uZW5lIGZvcmFuIHNlZyBvZyBzZQpodm9yZGFuIGRlIHJlZmxla3RlcnRlIGRlIHVsaWtlIGRvbWVuZW9iamVrdGVuZS4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDM+RiMvQyMtaW50ZXJvcDwvaDM+CiAgPHA+CiAgICBLb21waWxlcmVyIHRpbCBzYW1tZSBpbnRlcm1lZGlhdGUgbGFuZ3VhZ2UgKENMSSksIHNvbSBnasO4ciBpbnRlcm9wIG11bGlnLgogIDwvcD4KICA8YnI+CiAgPHA+CiAgICBDIyBrYW4gaW5rbHVkZXJlIEYjLWJpbmFyaWVzIHV0ZW4gw6UgdGVua2Ugc3Blc2llbHQgbXllIG92ZXIgYXQgZGV0IGVyIEYjLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBGIyBvZyBDIyBrb21waWxlcmVyIHRpbCBzYW1tZSBpbnRlcm1lZGlhdGUgbGFuZ3VhZ2UsIGRldHRlIGdqw7hyIGludGVyb3AgdGlsIGVuCmdhbnNrZSBiZWhhZ2VsaWcgb3BwbGV2ZWxzZS4gw4UgYnJ1a2UgdHlwZWRlZmluaXNqb25lciBmcmEgRiMgaSBDIyBsYWdldCB2YXIKdmVsZGlnIHJldHQgZnJlbSwgc29tIGplZyB2YXIgaW5uZSBww6UgdGlkbGlnZXJlLiBJbmtsdWRlciBlbiByZWZlcmFuc2UgdGlsCkYjLWJpYmxvdGVrZXQgb2cgb2ZmIHlvdSBnby4KICAgIDwvcD4KICAgIDxwPgogICAgICBTb20gamVnIGhhciB0b3VjaGEgaW5uIHDDpSBmw7hyIHPDpSBoYXIgZGV0dGUgdsOmcnQgZW4gbsO4a2tlbGZha3RvciBmb3IgYXQgRiMgZXIgZXQKdnVyZGVyYmFydCB2YWxnIGkgZW4gLk5FVC1zZXR0aW5nLgogICAgPC9wPgogICAgPHA+CiAgICAgIMOFIGthbGxlIEYjIGZ1bmtzam9uZXIgb2cgbWV0b2RlciBmcmEgQyMgdmFyIHN0b3J0IHNldHQgdXRlbiBla3N0cmEgbWlraywgbWVucyDDpQprYWxsZSBDIyBmcmEgRiMgZ2F2IG9zcyBsaXR0IGZsZXIgcHJvYmxlbWVyLi4uCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgzPkYjL0MjLWludGVyb3AgLSBOVUxMPC9oMz4KICA8cD4KICAgIE5lZ2VyZXIgZm9yZGVsZW4gbWVkIGF0IE5VTEwgaWtrZSBlciBlbiBsb3ZsaWcgdmVyZGkuCiAgPC9wPgogIDxicj4KICA8cD4KICAgIEVuIEYjIHJlY29yZCBzb20gaGFyIHbDpnJ0IGlubm9tIEMjIGthbiBpIHRlb3JpZW4gZsOlIHZlcmRpZW4gTlVMTC4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGt1bm5lIHPDpSBrbGFydCBpa2tlIHbDpnJlIGt1biBmcnlkIG9nIGVuaGrDuHJuaW5nZXIgc29tIGRyaXRlciByZWduYnVlci4gRGVuCnN0b3JlIGZvcmRlbGVuIG1lZCBGIyBvZyB0eXBlciBlciBhdCBOVUxMIGlra2UgZXIgZW4gZ3lsZGlnIHZlcmRpIGJ5IGRlZmF1bHQuClVsZW1wZW4gZXIgYXQgbWVkIGVuIGdhbmcgZW4gRiMgcmVjb3JkIHRhciB0dXJlbiBvcHBvbSBDIyBmb3IgZW4gZWxsZXIgYW5uZW4Kw6Vyc2FrIGthbiBkZW4gcGx1dHNlbGlnIGJsaSBOVUxMLgogICAgPC9wPgogICAgPHA+CiAgICAgIE7DpSBlciBkZXR0ZSBow6VuZHRlcmJhcnQsIGR1IGthbiBnasO4cmUgcGF0dGVybm1hdGNoaW5nIG1lZCBOVUxMIHNvbSB2ZXJkaSBtZWQKbGl0dCBib3gtdHJpa3NpbmcuCiAgICA8L3A+CiAgICA8cD4KICAgICAgU2lkZW4ga292ZXJ0ZXJpbmdlbiBmcmEgSlNPTiB0aWwgRiMgc2tqZWRkZSBpIEMjLWNvbnRyb2xsZXItbGFnZXQgc8OlIHZpbGxlCm1hbmdsZW5kZSB2ZXJkaWVyIGJsaSBzYXR0IHRpbCBOVUxMLiBIZXIgZmlubmVzIGRldCBzaWtrZXJ0IGJlZHJlIGzDuHNuaW5nZXIsIG1lbgpqZWcgc2t1bGxlIMO4bnNrZSBhdCBkZXQgdmFyIGVua2xlcmUgw6UgZmlubmUgZGVtLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMz5GIy9DIy1pbnRlcm9wIC0gYXN5bmM8L2gzPgogIDxwPgogICAgSWtrZSBkaXJla3RlIG92ZXJzZXR0YmFydCwgbcOlIGJydWtlIGtvbnZlcnRlcmluZ3NmdW5rc2pvbmVyLgogIDwvcD4KICA8YnI+CiAgPHA+CiAgICBMZXR0IMOlIGVrc3BvcnRlcmUgZnVua3Nqb25lciBzb20gcGFzc2VyIGlubiBpIEMjIGZyYSBGIy4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRW4gYW5uZW4gaW50ZXJvcC1lcmZhcmluZywgbWVuIGRlbm5lIHZhciBtZXIgYmVoYWdlbGlnIMOlIGpvYmJlIG1lZC4KICAgIDwvcD4KICAgIDxwPgogICAgICBBc3luYy1wcm9ncmFtbWVyaW5nIGkgRiMgb2cgQyMgZXIgaWtrZSBkaXJla3RlIG92ZXJzZXR0YmFyZS4gSHZpcyBkdSDDuG5za2VyIMOlCmthbGxlIGVuIEMjLWFzeW5jIG1ldG9kZSBpIEYjIG3DpSBkdSBicnVrZSBlbiBrb252ZXJ0ZXJpbmdzZnVua3Nqb24uIERldCB2YXIgbGl0dAprbm90IMOlIGZpbm5lIHV0IGF2LCBub2Ugc29tIGFudGFnZWxpZ3ZpcyBzdGFtbWVyIGZyYSBlbiBpa2tlIGZ1bGxzdGVuZGlnCmZvcnN0w6VlbHNlIGF2IGFzeW5jLWF3YWl0IGkgQyMuIE1lbiBuw6VyIGJpdGVuZSBmYWx0IHDDpSBwbGFzcyBnaWtrIGRldCBncmVpdC4KICAgIDwvcD4KICAgIDxwPgogICAgICBTaWRlbiBDIyBtYW5nbGVyIGt1bm5za2FwIG9tIEYjcyBhc3luYy1tb2RlbGwgZXIgZGV0IEYjLWtvZGVucyBhbnN2YXIgw6UKZWtzcG9ydGVyZSBmdW5rc2pvbmVyIHNvbSBlciBrYWxsYmFyZSBmcmEgQyMuIERldHRlIGZpbm5lcyBkZXQgaGVsZGlndmlzIGxldHQKdGlsZ2plbmdlbGlnZSBrb252ZXJ0ZXJpbmdzZnVua3Nqb25lciBmb3Igw6Ugb3BwbsOlLgogICAgPC9wPgogICAgPHA+CiAgICAgIERlciBodm9yIGZvcnNramVsbGVuIGkgaMOlbmR0ZXJpbmcgYXYgTlVMTCBza2FwdGUgcHJvYmxlbWVyLCB2YXIgZGVubmUgdHlwZW4KaW50ZXJvcCBlbiBteWUgbWVyIGJlaGFnZWxpZyBvcHBsZXZlbHNlLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMz5KU09OIG9nIEYjPC9oMz4KICA8cD4KICAgIERpc2NyaW1pbmF0ZWQgVW5pb25zIGhhciBpbmdlbiBnb2Qgb3ZlcnNldHRlbHNlIHRpbCBlbGxlciBmcmEgdHlwZWzDuHMgSlNPTi4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0dGUgZXIgbWVyIGV0IGxldHQgaXJyaXRhc2pvbnNtb21lbnQgZW5uIGVuIHNob3ctc3RvcHBlciwgb2cgZGV0IGZpbm5lcyBPSwpsw7hzbmluZ2VyIHDDpSBkZXQuIER1IGthbiBicnVrZSBEaXNjcmltaW5hdGVkVW5pb24tY29udmVydGVyIGZvciBKU09OZXQsIGRlbgpsZWdnZXIgcMOlIGVrc3RyYSBtZXRhZGF0YSBvbSBodmlsa2VuIGF2IHN1YnR5cGVuZSBpIGVuIERpc2NyaW1pbmF0ZWQgVW5pb24gZGVubmUKZGF0YWVuIHJlcHJlc2VudGVyZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgRHUga2FuIGFsbHRpZHMgc3RyaXBwZSB0eXBlLWluZm9ybWFzam9uZW4gZnJhIGRlbiBnZW5lcmVydGUKSlNPTi1kYXRhZW4sIG1lbiBkYSBmw6VyIGR1IHByb2JsZW1lciBuw6VyIGR1IHNrYWwgbGFncmUgZGVuIGlnamVuLiBMw7hzbmluZ2VuIHZpCnZhbGd0ZSBww6UgZGV0dGUgcHJvYmxlbWV0IHZhciDDpSBsYSBjbGllbnQtYXBwbGlrYXNqb25lbiB0YSBzZWcgYXYgb3ZlcnNldHRlbHNlbgpmcmEgRiMgb2cgdGlsYmFrZSB0aWwgRiMgbsOlciBkYXRhIHNrdWxsZSBsYWdyZXMuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgzPkYjLXNjcmlwdHM8L2gzPgogIDxwPgogICAgRW4gdW5kZXJ2dXJkZXJ0IGZlYXR1cmUuIEZ1bmdlcmVyIHV0bWVya2V0IHRpbCDDpSBsYWdlIENMSS10YXNrcyBvZyBhbmRyZSB1dGlscy4KICA8L3A+CiAgPGJyPgogIDxwPgogICAgVmVsZGlnIHByYWt0aXNrIGZvciB1dHZpa2xpbmcgaSB0b3NwYW5uIG1lZCBlbiBSRVBMLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBNdWxpZ2hldGVuIHRpbCDDpSBlbmtlbHQgbGFnZSBzbcOlIHNjcmlwdHMgc29tIGVua2VsdCBrYW4ga2rDuHJlcyBmcmEga29tbWFuZG9saW5qYQplbGxlciBsaWduZW5kZSBoYXIgdsOmcnQgZW4gdmVsZGlnIHN0b3IgZm9yZGVsLiDDhSBnasO4cmUgZGUgc2FtbWUKdHlwZWRlZmluaXNqb25lbmUgdmkgYnJ1a2VyIGZvciBkb21lbmVsb2dpa2sgdGlsZ2plbmdlbGlnIGZvciBhbmRyZSBmb3Jtw6VsIGVyIGVuCnN0b3IgZm9yZGVsLgogICAgPC9wPgogICAgPHA+CiAgICAgIEVuIGF2IGRlIHRpbmdlbmUgdmkgYmVueXR0ZXQgRiMtc2NyaXB0cyB0aWwgdmFyIMOlIGdlbmVyZXJlIEpTT04tZml4dXJlcyBmb3IKSmF2YVNjcmlwdC11bml0dGVzdHMuIFDDpSBkZW5uZSBtw6V0ZW4ga3VubmUgdmkgdsOmcmUgc2lrcmUgcMOlIGF0IHRlc3QtZGF0YSBhbGRyaQprb20gdXQgYXYgc3luYyBtZWQgZG9tZW5lZGVmaW5pc2pvbmVuZSBvZyBkZXJtZWQgZWxpbWluZXJlIGVuIGF2IGRlIHN0w7hyc3RlCmtpbGRlbmUgdGlsIGZhbHNlIHBvc2l0aXZlcyBpIHVuaXR0ZXN0cy4KICAgIDwvcD4KICAgIDxwPgogICAgICBFbiBhbm5lbiB0aW5nIHZpIG9nc8OlIGJlbnl0dGV0IEYjIHNjcmlwdHMgdGlsIHZhciDDpSBrasO4cmUgZW5rbGUgam9iYmVyIHNvbSDDpQpoZW50ZSBkYXRhIGZyYSBnb29nbGUgZG9jcy4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIGxpZ2h0IiBkYXRhLWJhY2tncm91bmQ9IiMxYzIwMmIiPgogIDxoMj5XSU4gQ09ORElUSU9OUzwvaDI+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgTsOlIHNrYWwgamVnIGfDpSBsaXR0IHRpbGJha2Ugb2cgc3luc2UgbGl0dCBvbSBodmEgc29tIGdqb3JkZSBhdCBGIyBmdW5nZXJ0ZSBmb3IKb3NzIG9nIG9tIGRldCBlciBub2VuIHNwZXNpZWxsZSBlZ2Vuc2thcGVyIHZlZCBkZW4ga29udGVrc3RlbiBwcm9zamVrdGV0IHbDpXJ0CmVrc2lzdGVydGUgaSBzb20gYmlkcm8gaSBzcGVzaWVsdCBzdG9yIGdyYWQgdGlsIGRldC4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIj4KICA8aDM+S29tcGxla3NpdGV0PC9oMz4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBEZXR0ZSB2YXIgZXQgbGl0ZSBrb21wbGVrc3QgZG9tZW5lIMOlIGJlbnl0dGUgRiMgaS4gRGV0dGUgaGFyIHPDpWtsYXJ0IGhhdHQgbXllIMOlCnNpIGZvciBodm9yIG1hbmdlIHJvYWRibG9ja3MgdmkgYnVtcGVyIGJvcnRpIGlsw7hwZXQgYXYgdXR2aWtsaW5nc2zDuHBldC4gU29tIGplZwp2YXIgaW5uZSBww6UgdGlkbGlnZXJlIHPDpSB2YXIgZGV0dGUgaG92ZWRncnVubmVuIHRpbCBhdCBqZWcgaWtrZSBoYXIgdmlzdCBub2UKa29kZSBpIGRlbm5lIHByZXNlbnRhc2pvbmVuLgogICAgPC9wPgogICAgPHA+CiAgICAgIFZpIGhhciBww6UgaW5nZW4gbcOldGUgcHVzaGEgRiMgdGlsIHNpbmUgZ3JlbnNlciwgbWVuIGlnamVuLCBodm9yIG9mdGUgZ2rDuHIgdmkKZWdlbnRsaWcgZGV0PyBEZXQgZmlubmVzIG1hbmdlIHByb3NqZWt0ZXIsIGVsbGVyIHN1Yi1wcm9zamVrdGVyLCBzb20gaWtrZSBlciBzw6UKb21mYXR0ZW5kZSBhdCBkZXQgdHJlbmdzIGV0IHRla25vbG9naXLDpWQgZm9yIMOlIGF2Z2rDuHJlIGh2b3J2aWR0IG55IHN5bnRheCBlciBlbgpyaXNpa28gdmVyZHQgZ2V2aW5zdGVuLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMz5UZWtuaXNrZSBmb3J0cmlubjwvaDM+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGVyIHZhbnNrZWxpZyDDpSBnasO4cmUgZW4gYXBwbGVzIHRvIGFwcGxlcyBzYW1tZW5saWduaW5nIGF2IGRlIHRla25pc2tlCmVnZW5za2FwZW5lIHRpbCB0byBzcHLDpWsuIE1lbiwgZGVuIGZ1bmtzam9uZWxsZSBuYXR1cmVuIHRpbCBGIyBvcHBmb3JkcmVyIHN0ZXJrdAp0aWwgw6Uga29uc3RydWVyZSBtb2RlbGxlciBzb20gZXIgZnVuZGFtZW50YWx0IGVua2xlcmUgZW5uIGRldCBzb20gZXIgbmF0dXJsaWcgaQpldCB0cmFkaXNqb25lbGx0IGltcGVyYXRpdnQgZWxsZXIgb2JqZWt0IG9yaWVudGVydCBzcHLDpWsuIEltbXV0YWJpbGl0eSBvZyBhbmRyZQpmb3JudWZ0aWdlIGRlZmF1bHRzIGkgRiMgZ2rDuHIgZGV0IGxldHQgw6Ugc2tyaXZlIGVua2VsIGtvZGUuCiAgICA8L3A+CiAgICA8cD4KICAgICAgSmVnIGhhciBpa2tlIHRlbmt0IMOlIGfDpSB2ZWxkaWcgbXllIG1lciBpbm4gcMOlIGFra3VyYXQgZGV0dGUsIG1lbiBoZWxsZXIgaGVudmlzZQp0aWwgUmljaCBIaWNrZXlzIHByZXNlbnRhc2pvbmVyIG9tIGVua2VsaGV0L3NpbXBsaWNpdHkuIEVyIGthbnNramUgbGl0dCByYXJ0IMOlCnNlIHDDpSBlbmtlbGhldCBzb20gZXQgdGVrbmlzayBmb3J0cmlubiwgbWVuIGFsdCBzb20gZsO4cmVyIHRpbCBtaW5kcmUgbWVudGFsCm92ZXJoZWFkIGbDuHJlciB0aWwgZsOmcnJlIGJ1Z3MsIG9nIGRldCBlciBldCB0ZWtuaXNrIGZvcnRyaW5uLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMz5Gb3Jow6VuZHNrdW5uc2thcDwvaDM+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgw4UgaGEgbm9lbiBtZWQgZm9yaMOlbmRza3VubnNrYXAgdGlsIMOlIHNldHRlIGlnYW5nIHByb3Nlc3NlciBlciBueXR0aWcuIFZpIHZhcgpoZWxkaWdlIG9nIGhhZGRlIGVuIHJlc3N1cnMgcMOlIHRlYW1ldCBtZWQgZ29kIGtqZW5uc2thcCB0aWwgc3Byw6VrZXQgb2cKw7hrb3N5c3RlbWV0IGkgc3RhcnRlbi4KICAgIDwvcD4KICAgIDxwPgogICAgICBWb2thYnVsYXIgZXIgZW4gYXYgZGUgdGluZ2VuZSBzb20gZ2rDuHIgZGV0IHZhbnNrZWxpZyDDpSBsw6ZyZSBzZWcgbm9lIG55dHQuIMOFIGhhCmVuIHBlcnNvbiB0aWxnamVuZ2VsaWcgc29tIGthbiBvdmVyc2V0dGUgZnJhIHZlbGtqZW50ZSBiZWdyZXBlciBvZyBkb21lbmVyIHRpbApkZXR0ZSBueWUgZG9tZW5ldCBnasO4ciBhdCB0aW5nIGfDpXIgbXllIGdyZWllcmUuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9Im1pZHRlbiI+CiAgPGgzPk1vdGl2YXNqb24sIG55c2dqZXJyaWdoZXQgb2cgZW50dXNpYXNtZTwvaDM+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgTW90aXZhc2pvbiwgbnlzZ2plcnJpZ2hldCBvZyBlbnR1c2lhc21lIGVyIHZpa3RpZ2UgZmFrdG9yZXIgZm9yIGh2b3J2aWR0IGVuCnV0dmlrbGVyIHZpbCBrb21tZSBzZWcgZm9yYmkgZsO4cnN0ZSBoaW5kZXIgbsOlciBldCBueXR0IHByb2dyYW1tZXJpbmdzcHLDpWsgc2thbApsw6ZyZXMuIEh2aXMgZGlzc2UgdGluZ2VuZSBpa2tlIGZpbm5lcyBpIGRlbiBncnVwcGEgcHJvZ3JhbW1lcmVyZSBkdSDDuG5za2VyIMOlCmludHJvZHVzZXJlIGV0IG55dHQgc3Byw6VrIGZvciBzw6UgYmxpciBkZXQgdmFuc2tlbGlnLgogICAgPC9wPgogICAgPHA+CiAgICAgIE7DpXIgdXR2aWtsZXJlbiBpIHByb3NqZWt0ZXQgc29tIGhhZGRlIGVrc3BlcnRpc2VuIHDDpSBGIyBkcm8gcMOlIGpvcmRvbXNlaWxpZyBpCmV0dCDDpXIgbHVydGUgdmkgbGl0dCBww6Ugb20gdmkga29tIHRpbCDDpSBrbGFyZSDDpSBmb3J2YWx0ZSBGIy1rb2RlYmFzZW4uIEZhc2l0ZW4KZXR0IMOlciBldHRlciBlciBhdCB2aSBpa2tlIGJhcmUgaGFyIGZvcnZhbHRhIGtvZGViYXNlbiwgbWVuIHZpIGhhciBza3JldmV0IGRlbgpvbSBvZyB1dHZpZGEgb21mYW5nZXQgbWVkIG5lc3RlbiBkZXQgZG9iYmVsdGUgaSBkZW4gdGlkZW4uIEdvZGUgc3Byw6VrIGVyIGfDuHkgw6UKam9iYmUgbWVkIG9nIGZvcm7DuHlkZSB1dHZpa2xlcmUgZXIgZ29kZSB1dHZpa2xlcmUuCiAgICA8L3A+CiAgICA8cD4KICAgICAgUmlzaWtvIHZlZCB0ZWtub2xvZ2l2YWxnIHJlZHVzZXJlcyBuw6VyIHV0dmlrbGVyZSBlciB2aWxsaWdlIHRpbCDDpSBnw6UgZGVuIGVrc3RyYQptaWxhIGZvcmRpIGRldCDDpSBnw6UgZXIgdmVyZGlmdWxsdCBpIHNlZyBzZWx2LiBOw6VyIGR1IGVyIHPDpSBoZWxkaWcgw6Ugam9iYmUgc2FtbWVuCm1lZCBtb3RpdmVydGUsIGVuZ2FzamVydGUgb2cgbnlzZ2plcnJpZ2UgbWVubmVza2VyIGVyIGRldCB2aWt0aWcgw6UgZm9ydHNldHRlIMOlCnBsZWllIGRlbiB0eXBlbiBrdWx0dXIuIERldHRlIGVyIG5vZSBzb20gbcOlIGZvcnZhbHRlcyByZXR0IGZvciDDpSBmdW5nZXJlLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMz5GZWxsZXNrYXBldDwvaDM+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGVrc2lzdGVyZXIgZW5vcm10IG15ZSBicmEgaW5mbyBww6UgaW50ZXJuZXR0IHNrcmV2ZXQgYXYga3VubnNrYXBzcmlrZQppbGRzamVsZXIuIERldHRlIGhhciB2w6ZydCB1dHJvbGlnIHZpa3RpZyBmb3Igb3NzIHNvbSBmYW1sZXIgbGl0dCBydW5kdCBvZyBpa2tlCmFsbHRpZCB2ZXQgaHZhIHZpIGdqw7hyLgogICAgPC9wPgogICAgPHA+CiAgICAgIERldHRlIGVyIGVuIGF2IGdydW5uZW4gc29tIGdqw7hyIEYjIHRpbCBldCBteWUgdHJ5Z2dlcmUgdmFsZyBlbm4gZGV0IGt1bm5lIHbDpnJ0LgpJbmZvcm1hc2pvbiBhdiBnb2Qga3ZhbGl0ZXQgZXIgdGlsZ2plbmdlbGlnIHDDpSBhbGxlIGRlIHZhbmxpZ2Ugc3RlZGVuZSwgb2cKc3lubGlnaGV0ZW4gYmxpciBiYXJlIHN0w7hycmUgZXR0ZXJodmVydCBzb20gdGlkYSBnw6VyLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMj5UQUtLIEZPUiBNRUc8L2gyPgogIDxoNz5TdGlhbiBWZXVtIE3DuGxsZXJzZW4gLyBAbW9sbGVyc2U8L2g3PgogIDxoNz5CRUtLPC9oNz4KPC9zZWN0aW9uPgo=","base64");
var title = 'En F# trojansk hest – Erfaringer fra bruken av et F#-domene i en C#-kontekst';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;

}).call(this,require("buffer").Buffer)
},{"buffer":1}]},{},[5]);
