function PagedHash()
{
  this.page_table = new Array(PagedHash.PageCount * PagedHash.PageSize);
  this.ranges = new Array();
}

PagedHash.NotMappedError = function(addr) {
  this.msg = "Not mapped error: " + addr;
  this.address = addr;
}

PagedHash.AlreadyMappedError = function(addr) {
  this.msg = "Already mapped error: " + addr;
  this.address = addr;
}

PagedHash.PageCount = 1024;
PagedHash.PageSize = 1024 * 4;

function page_count(n, size)
{
  if(size == null) size = PagedHash.PageSize;
  return Math.ceil(n / size);
}

PagedHash.Range = function(n, addr, size, value)
{
  this.id = n;
  this.addr = addr;
  this.size = size;
  this.page_count = page_count(size);
  this.value = value;
}

PagedHash.prototype.add = function(addr, size, value)
{
  if(this.get(addr)) throw new PagedHash.AlreadyMappedError(addr);
  var range = new PagedHash.Range(this.ranges.length, addr, size, value);
  this.ranges.push(range);
  this.add_page_table_entries(range);
  return this;
}

PagedHash.prototype.remove = function(addr)
{
  var range = this.get(addr);

  if(range) {
    this.remove_page_table_entries(range);
    delete this.ranges[range.id];
  } else {
    throw new PagedHash.NotMappedError(addr);
  }

  return this;
}

PagedHash.prototype.get = function(addr)
{
  return this.page_table[this.page_for_address(addr)];
}

PagedHash.prototype.get_value = function(addr)
{
  var item = this.get(addr);
  if(item) return item.value;
  else throw new PagedHash.NotMapppedError(addr);
}

PagedHash.prototype.set_value = function(addr)
{
  this.get(addr).value = value;
}

PagedHash.prototype.range_for = function(value)
{
  for(var i in this.ranges) {
    if(this.ranges[i].value == value) {
      return this.ranges[i];
    }
  }

  return null;
}

PagedHash.prototype.add_page_table_entries = function(item)
{
  var page = this.page_for_address(item.addr);
  
  for(var i = 0; i < item.page_count; i++) {
    this.page_table[page + i] = item;
  }
}

PagedHash.prototype.remove_page_table_entries = function(item)
{
  var page = this.page_for_address(item.addr);
  
  for(var i = 0; i < item.page_count; i++) {
    this.page_table[page + i] = null;
  }
}

PagedHash.prototype.page_for_address = function(addr)
{
  return Math.floor(addr / PagedHash.PageSize);
}

PagedHash.prototype.map = function(f)
{
  return this.ranges.map(f);
}

if(typeof(module) != 'undefined') {
  module.exports = PagedHash;
}
