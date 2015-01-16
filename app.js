'use strict';
//TODO : add namespace for client mode !

var config = require('./config/config.json'),
  transporter = [],
  _ = require('lodash'),
  initialScanComplete = false,
  mdns = require('mdns'),
  mkdirp = require('mkdirp'),
  reconnected = false,
  reconnecting = false,
  currentServiceAddress = '',
  fs = require('fs'),
  namespaces = [],
  host = '',
  app;

var initTransporter = function() {
  if ((config.transport === 'socket.io' || config.transport === 'both') && config.state === 'server') {
    console.log('Init socket.io server mode...');
    var io = require('socket.io')(app);
    if (config.state === 'server') {
      // advertise a http server on port 4321
      var ad = mdns.createAdvertisement(mdns.tcp('socket-io'), config.port);
      ad.start();
    }
    //var io = require('socket.io').listen(config.socketIO.port);
    var socketIO = {
      name: 'socket.io',
      sender: io,
      socketConnections: [],
      send: function(path, action) {
        if (this.socketConnections.length < 0) {
          console.log('No socket open');
        } else {
          if (config.debug == true) {
            console.log('Sending ' + action + ' using socket.io');
          }
          _.each(this.socketConnections, function(socket) {
            socket.emit(action, {
              src: path
            });
          });
        }
      }
    };

    socketIO.sender.sockets.on('connection', function(socket) {
      socket.on('hello', function(data) {
        if (config.debug == true) {
          console.log('client connected');
          console.log(data);
        }
      });
      socketIO.socketConnections.push(socket);
    });
    transporter.push(socketIO);

  } else if ((config.transport === 'socket.io' || config.transport === 'both') && config.state === 'client') {

    // Could be improved
    initSocketIOClient(config.client.address, config.client.port);

    // watch all http servers
    var panini = mdns.createBrowser(mdns.tcp('socketio'));
    panini.on('serviceUp', function(service) {
      console.log("service up: ", service.fullname);
      //Should be cleaned to avoid creating useless
      //transporter = _.rest(transporter, { 'employer': 'slate' });
      if (currentServiceAddress !== service.host.substr(0, service.host.length - 1)) {
        initSocketIOClient(service.host.substr(0, service.host.length - 1), service.port)
        currentServiceAddress = service.host.substr(0, service.host.length - 1);
      }

    });
    panini.on('serviceDown', function(service) {
      console.log("service down: ", service.fullname);
    });
    panini.start();
  }

  if (config.transport === 'osc' || config.transport === 'both') {
    var osc = require('node-osc'),
      OSCclient = new osc.Client(config.osc.address, config.osc.port),
      OSCSender = {
        name: 'osc',
        sender: OSCclient,
        send: function(path, action) {
          if (config.debug == true) {
            console.log('Sending ' + action + ' using osc');
          }
          this.sender.send(action, path);
        }
      }
    transporter.push(OSCSender);
  }
};

var initSocketIOClient = function(address, port) {
  console.log('Init socket.io client mode : ', address, port);
  var socket = require('socket.io-client')('http://' + address + ':' + port);
  socket.on('connect', function() {
      socket.emit('binding');
      console.log('connected to socket.io server');
    })
    .on('disconnect', function() {
      console.log('We\'ve been disconnected');
    })
    .on('error', function() {
      console.log('error while connecting');
    })
    .on('reconnect', function(nbtry) {
      console.log('Successfull reconnect after ' + nbtry + ' trying.');
    })
    .on('reconnecting', function(nbtry) {
      // console.log('Trying to reconnect.');
    })
    .on('bind-nsp', function(nsp) {
      if (config.watch.path)
        if (_.contains(namespaces, nsp) === false) {
          mkdirp(config.watch.path + nsp, function(err) {
            if (err) {
              console.log('mkdirp: ' + err);
            }
          });
          namespaces.push(nsp);
        }
      var nspSocket = require('socket.io-client').connect('http://' + address + ':' + port + nsp);
      transporter.push(createSocketTransporter(nsp, nspSocket));
    });

  namespaces.push('/');
  transporter.push(createSocketTransporter('/', socket));
}

function createSocketTransporter(name, socket) {
  var socketIO = {
    name: name,
    sender: socket,
    send: function(path, action) {
      if (config.debug == true) {
        console.log('Sending', action, 'using', name);
      }
      socket.emit(action, {
        src: path
      });
    }
  };
  return socketIO;
}

var initWatcher = function() {
  var chokidar = require('chokidar');

  var watcher = chokidar.watch(config.watch.path, {
    ignored: /[\/\\]\./,
    persistent: true
  });

  watcher
    .on('add', function(path) {

      if (initialScanComplete) {
        try {
          console.log(path);
          console.log(config.watch.path);
          var os = require("os");
          var relativePath = path.replace(config.watch.path, 'http://' + host + ":" + config.port);

          console.log(relativePath);

          var splitedPath = path.split('/');
          var nsp = splitedPath[splitedPath.length - 2];
          nsp = nsp === config.watch.path.split('/').pop() ? '' : nsp;

          var transporterSocketio = _.where(transporter, {
            name: '/' + nsp
          });
          transporterSocketio[0].send(relativePath, 'image-saved');

          if (config.transport === 'osc' || config.transport === 'both') {
            var transporterOsc = _.where(transporter, {
              name: 'osc'
            });
            transporterOsc[0].send(relativePath, 'new-file');
            transporterOsc[0].send(relativePath, 'new-image'); // legacy until june 2015
          }
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log('Chokidar - File', path, 'was here');
      }
    })
    .on('addDir', function(path) {
      console.log('Chokidar - Directory', path, 'has been added');
    })
    .on('change', function(path) {
      console.log('Chokidar - File', path, 'has been changed');
    })
    .on('unlink', function(path) {
      if (initialScanComplete) {
        try {
          var relativePath = path.replace(config.watch.path, 'http://' + host + ":" + config.port);
          console.log(relativePath);

          var splitedPath = path.split('/');
          var nsp = splitedPath[splitedPath.length - 2];
          nsp = nsp === config.watch.path.split('/').pop() ? '' : nsp;

          var transporterSocketio = _.where(transporter, {
            name: '/' + nsp
          });
          transporterSocketio[0].send(relativePath, 'image-deleted');

          if (config.transport === 'osc' || config.transport === 'both') {
            var transporterOsc = _.where(transporter, {
              name: 'osc'
            });
            transporterOsc[0].send(relativePath, 'image-deleted');
          }
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log('File', path, 'was here');
      }
      console.log('File', path, 'has been removed');
    })
    .on('unlinkDir', function(path) {
      console.log('Chokidar - Directory', path, 'has been removed');
    })
    .on('error', function(error) {
      console.error('Chokidar - Error happened', error);
    })
    .on('ready', function() {
      console.info('Chokidar - Initial scan complete. Ready for changes.');
      initialScanComplete = true;
    })
    .on('raw', function(event, path, details) {
      //console.info('Raw event info:', event, path, details)
    })
}

var initStatiqueServer = function() {
  var Statique = require("statique");

  // Create *Le Statique* server
  var server = new Statique({
    root: config.watch.path,
    cache: 36000
  }).setRoutes({
    "/": "/html/index.html"
  });

  // Create server
  app = require('http').createServer(server.serve);
}

console.log("Initializing...");

if (fs.existsSync(config.watch.path)) {
  initStatiqueServer();
  initTransporter();
  //TODO add some ready event to tell the watcher to init.
  initWatcher();
  console.log("...Initialized");
  // Output
  var os = require("os");
  host = os.hostname();
  if (os.platform() === 'linux') {
    var child_process = require("child_process");
    child_process.exec("hostname -f", function(err, stdout, stderr) {
      host = stdout.trim();
    });
  }
  console.log("Listening on: " + config.port);
  app.listen(config.port)
    .on('error', function(err) {
      console.log(err);
      process.exit(1);
    });
} else {
  console.log('Sorry, we can\'t watch something that does not exist');
}