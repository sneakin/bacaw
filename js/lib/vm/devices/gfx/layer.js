function Layer(id, canvas, data, w, h, x, y, z, alpha)
{
    this.canvas = canvas;
    this.data = data;
    var self = this;
    this.id(id);
    this.width(w);
    this.height(h);
    this.x(x || 0);
    this.y(y || 0);
    this.z(z || 0);
    this.alpha(alpha || 0.0);
}

Layer.FIELDS = {
    id: function(v) { },
    visible: function(v) { this.canvas.style.visibility = (v > 0) ? 'visible' : 'hidden'; },
    width: function(v) { this.canvas.style.width = this.canvas.width = v; },
    height: function(v) { this.canvas.style.height = this.canvas.height = v; },
    x: function(v) { this.canvas.style.left = v; },
    y: function(v) { this.canvas.style.top = v; },
    z: function(v) { this.canvas.style.zIndex = v; },
    alpha: function(v) { this.canvas.style.opacity = v; }
};

Layer.add_attr = function(name, setter)
{
    Layer.prototype[name] = function(v) {
        if(v) {
            this.data[name] = v;
        }
        return this.data[name];
    }
}

for(var f in Layer.FIELDS) {
    Layer.add_attr(f, Layer.FIELDS[f]);
}

Layer.prototype.get_context = function(type)
{
    if(this.context == null) {
        this.context = this.canvas.getContext(type || '2d');
    }

    return this.context;
}

if(typeof(module) != 'undefined') {
    module.exports = Layer;
}
