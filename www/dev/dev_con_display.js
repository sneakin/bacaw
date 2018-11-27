function DevConDisplay(parent, element, devcon)
{
    this.parent = parent;
    this.element = element;
    
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

    this.scroll_to_top();
    return this;
}

DevConDisplay.prototype.scroll_to_top = function()
{
    var scroll_pos = (this.parent.scrollTop + this.parent.clientHeight);
    var scroll_max = this.parent.scrollHeight;
    var delta = scroll_max - scroll_pos;
    console.log("Scrolling?", scroll_pos, scroll_max, delta, li.clientHeight);
    if(delta < li.clientHeight * 2) {
        this.parent.scrollTo(0, scroll_max);
    }
    return this;
}

if(typeof(module) != 'undefined') {
    module.exports = DevConDisplay;
}
