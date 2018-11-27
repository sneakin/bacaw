const RAM = require('vm/devices/ram.js');

PixelBuffer = function(width, height)
{
    this.width = width || w;
    this.height = height || h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context = this.canvas.getContext('2d');
    this.buffer = this.context.createImageData(this.width, this.height);
    this.ram = new RAM(this.buffer.data);
    this.length = this.ram.length;
}

PixelBuffer.prototype.put_pixels = function(dest, x, y, sx, sy, w, h)
{
    this.context.putImageData(this.buffer, 0, 0, sx, sy, w, h);
    dest.drawImage(this.canvas,
                   sx, sy, w, h,
                   x + sx, y + sy, w, h);
}

PixelBuffer.prototype.copy_pixels = function(sx, sy, dx, dy, w, h)
{
    this.copy_image(this.buffer, sx, sy, dx, dy, w, h);
}

PixelBuffer.prototype.copy_image = function(img, sx, sy, dx, dy, w, h)
{
    if(w == null) w = img.width;
    if(h == null) h = img.height;
    var channels = 4;
    for(var row = 0; row < h; row++) {
        var di = (dy + row) * this.buffer.width * channels + dx * channels;
        if(di >= this.buffer.data.length) break;
        this.buffer.data.set(img.data.subarray((sy + row) * img.width * channels + (sx * channels),
                                               (sy + row) * img.width * channels + (sx + w) * channels),
                             di);
    }
}

PixelBuffer.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

PixelBuffer.prototype.write = function(addr, data)
{
    return this.ram.write(addr, data);
}

if(typeof(module) != 'undefined') {
    module.exports = PixelBuffer;
}
