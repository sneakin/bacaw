function InterruptHandle(container, irq)
{
  this.container = container;
  this.irq = irq;
}

InterruptHandle.prototype.trigger = function()
{
  this.container.interrupt(this.irq);
  return this;
}

InterruptHandle.prototype.toInt = function()
{
  return this.irq;
}

InterruptHandle.prototype.toString = function(base)
{
  return this.irq.toString(base);
}

if(typeof(module) != 'undefined') {
  module.exports = InterruptHandle;
}
