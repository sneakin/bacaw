const VERSION = 4;

function DBStore(db_name, callback, version)
{
  this.db_name = db_name;
  this.version = version || VERSION;
  this.enable(callback);
}

DBStore.prototype.upgrade = function(callback)
{
  if(!this.db.objectStoreNames.contains(this.db_name)) {
    var req = this.db.createObjectStore(this.db_name, { keyPath: 'key' });
    req.onsuccess = () => { callback(false); };
    req.onerror = () => { callback(true); };
    req.createIndex('key', 'key', { unique: true });
  } else {
    // any migrations?
    callback(false);
  }
  return this;
}

DBStore.prototype.transaction = function(mode, oncomplete, onerror)
{
  var transaction = this.db.transaction([this.db_name], mode || 'readonly');
  transaction.oncomplete = oncomplete || ((error) => console.log('txn complete', error));
  transaction.onerror = onerror || ((error) => console.log('txn error', error));
  return transaction.objectStore(this.db_name);
}

DBStore.prototype.enable = function(callback)
{
  if(!this.db) {
    if(typeof(indexedDB) == 'undefined') {
      callback(true);
      return false;
    }
    
    var req = indexedDB.open(this.db_name, this.version);
    req.onerror = (event) => { this.db = null; callback(true); }
    req.onsuccess = (event) => { this.db = req.result; callback(false); }
    req.onupgradeneeded = (event) => {
      this.db = req.result;
      this.upgrade(callback);
    }
  } else {
    callback(false);
  }
  
  return this;
}

DBStore.prototype.disable = function(callback)
{
  if(this.db) {
    this.db.close();
    this.db = null;
  }

  callback(false);
  return this;
}

DBStore.prototype.getItem = function(key, callback)
{
  var transaction = this.transaction('readonly',
                                     (event) => {
                                       callback(key, req.result);
                                     }, (event) => {
                                       callback(key, null);
                                     });
  var req = transaction.get(key);
  return this;
}

DBStore.prototype.getValue = function(key, offset, max_length, callback)
{
  return this.getItem(key, (new_key, item) => {
    var data = item ? item.value : null;
    if(data && (offset || max_length)) {
      var length = Math.min(data.length, max_length);
      data = data.slice(offset, offset + length);
    }
    callback(new_key, data);
  });
}

DBStore.prototype.getSize = function(key, callback)
{
  return this.getItem(key, (new_key, item) => {
    callback(new_key, item ? item.size : null);
  });
}

DBStore.prototype.setItem = function(key, value, callback)
{
  var tn = this.transaction('readwrite',
                            (event) => { callback(key, true); },
                            (event) => { callback(key, null); });
  var req = tn.put({ key: key, value: value, size: value.length });
  return this;
}

DBStore.prototype.removeItem = function(key, callback)
{
  var tn = this.transaction('readwrite',
                            () => { callback(key, true); },
                            () => { callback(key, false); });
  var req = tn.delete(key);
  return this;
}

if(typeof(module) != 'undefined') {
  module.exports = DBStore;
}
if(typeof(window) != 'undefined') {
  window.KeyValueDB = DBStore;
}
