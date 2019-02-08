/* Manages individual sets of tabs and pages.
* Options:
tabs: element to place tabs at
pages: elements that need tabs 
*/
function Tabber(options)
{
  this.populate_tabs(options.tabs, options.pages);
  this.show_tab(options['initial'] || 0);
}

Tabber.prototype.populate_tabs = function(parent, pages)
{
  var tabs = [];
  this.list = this.create_list();
  parent.appendChild(this.list);
  
  for(var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var title = 'Tab ' + tabs.length;
    var heading = pages[i].querySelector('h1');
    if(heading) {
      title = heading.innerText;
      heading.hidden = true;
    }
    
    var tab = new Tab(title, i, page, this);
    this.list.appendChild(tab.li);
    tabs.push(tab);
  }

  this.tabs = tabs;
}

Tabber.prototype.create_list = function()
{
  var el = document.createElement('ul');
  el.classList.add('tabs');
  return el;
}

function Tab(text, n, page, tabber)
{
  this.index = n;
  this.page = page;
  this.li = document.createElement('li');
  this.anchor = document.createElement('a');
  this.anchor.innerText = text;
  var self = this;
  this.anchor.onclick = function() {
    tabber.show_tab(self.index);
  };
  this.li.appendChild(this.anchor);
}

Tab.prototype.show = function()
{
  this.page.style.display = 'block';
  this.li.classList.add('active');
}

Tab.prototype.hide = function()
{
  this.page.style.display = 'none';
  this.li.classList.remove('active');
}

Tabber.prototype.hide_all = function()
{
  for(var t = 0; t < this.tabs.length; t++) {
    this.tabs[t].hide();
  }
}

Tabber.prototype.show_tab = function(page)
{
  this.hide_all();
  this.tabs[page].show();
}

/* Options:
* pagesets: a set of objects with a `tabs` attribute set to an element to place tabs at and a `pages` attribute with elements for each page in the set.
*/
Tabber.init = function(options)
{
  for(var set in options.sets) {
    this.tabbers.push(new Tabber(options.sets[set]));
  }
}

Tabber.tabbers = [];

module.exports = Tabber;
