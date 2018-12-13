function DevConDisplay(parent, element, devcon, line_height)
{
    this.parent = parent;
    this.element = element;
    this.line_height = line_height || 10;
    
    var self = this;
    devcon.add_callback(function(str) {
        self.log(str);
    });
}

DevConDisplay.prototype.log = function(str)
{
    var li = document.createElement('li');
    li.innerText = str;
    this.element.appendChild(li);
    this.line_height = li.clientHeight;

    this.scroll_to_top();
    return this;
}

DevConDisplay.prototype.scroll_to_top = function()
{
    var scroll_pos = (this.parent.scrollTop + this.parent.clientHeight);
    var scroll_max = this.parent.scrollHeight;
    var delta = scroll_max - scroll_pos;

    if(delta < this.line_height * 2) {
        this.parent.scrollTo(0, scroll_max);
    }
    
    return this;
}

if(typeof(module) != 'undefined') {
    module.exports = DevConDisplay;
}
