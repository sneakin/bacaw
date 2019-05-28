function DeviceInfo(parent, device, address)
{
    this.name = document.createElement('dt');
    this.name.innerText = device.name || "Unknown";
    parent.appendChild(this.name);
    this.info = document.createElement('dd');
    this.info.innerText =
          "IRQ: " + device.irq + "\n"
          + "Address: " + (address || 0).toString(16);
    parent.appendChild(this.info);
}

DeviceInfo.prototype.update = function(dev)
{
}

function DeviceList(parent, vm)
{
    this.elements = [];
    this.list = document.createElement('dl');
    parent.appendChild(this.list);

    var self = this;
    vm.each_device(function(dev, n) {
        self.add_device(vm, dev, n);
    });
}

DeviceList.prototype.add_device = function(vm, dev, n)
{
    addr = vm.mem.start_address_for(dev);
    this.elements[n] = new DeviceInfo(this.list, dev, addr);
}

DeviceList.prototype.update = function(vm)
{
    var self = this;
    vm.each_device(function(dev, n) {
        if(self.elements[n] == null) {
            self.add_device(vm, dev, n);
        }

        self.elements[n].update(dev);
    });
}

if(typeof(module) != 'undefined') {
    module.exports = DeviceList;
}
