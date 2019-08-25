const more_util = require('more_util');

require('vm');

function MemoryDisplay(vm, page_size, row_size)
{
    var self = this;
    
    this.vm = vm;
    this.page_size = page_size;
    this.row_size = row_size;
    this.row_count = page_size / row_size;

    this.offset_input = document.getElementById('memory-offset');
    this.offset_input.onchange = function(e) {
        self.set_address(e.target.value);
    }
    this.page_input = document.getElementById('memory-page');
    this.page_input.onchange = function(e) {
        self.set_page(e.target.value);
    }

  this.next_page = document.getElementById('memory-next-page');
  this.next_page.onclick = function() {
    self.set_page(self.page() + 1);
  }

  this.prev_page = document.getElementById('memory-prev-page');
  this.prev_page.onclick = function() {
    self.set_page(self.page() - 1);
  }
  
    var table = document.getElementById('memory-table');
    var template = table.getElementsByClassName('template')[0];
    template.remove();
    
    this.zeros = new Array(this.row_size);
    for(var i = 0; i < this.row_size; i++) {
        this.zeros[i] = 0;
    }
    
    this.rows = new Array(this.row_count);
    for(var i = 0; i < this.row_count; i++) {
        var row = template.cloneNode(true);
        var addr = row.getElementsByClassName('address')[0];
        var data = row.getElementsByClassName('data')[0];
        this.rows[i] = [ addr, data ];
        table.appendChild(row);
    }

    this.set_page(0);
}

MemoryDisplay.prototype.set_page = function(page)
{
    this.set_address(page * this.page_size);
}

MemoryDisplay.prototype.set_address = function(addr)
{
    var page = Math.floor(addr / this.page_size);
    var offset = page * this.page_size;

    this.page_input.value = page;
    this.offset_input.value = offset;

    this.update_data();
}

MemoryDisplay.prototype.page = function()
{
  return parseInt(this.page_input.value);
}

MemoryDisplay.prototype.update_data = function()
{
    var page = this.page();
    
    for(var i = 0; i < this.row_count; i++) {
        var row_addr = (page * this.page_size) + (i * this.row_size);
        this.rows[i][0].innerText = row_addr.toString(16).padStart(8, '0');
        this.rows[i][1].innerText = more_util.to_hexdump(this.memread(row_addr));
    }
}

MemoryDisplay.prototype.memread = function(addr)
{
    try {
        return this.vm.mem.memread(addr, this.row_size);
    } catch(e) {
        if(e instanceof VM.MemoryBus.NotMappedError) {
            return this.zeros;
        } else {
            throw(e);
        }
    }
}

MemoryDisplay.prototype.update = function()
{
    this.update_data();
}

if(typeof(module) != 'undefined') {
    module.exports = MemoryDisplay;
}
