'use strict';

var config = require('./config/config.json'),
  transporter = [],
  _ = require('lodash'),
  initialScanComplete = false,
  mdns = require('mdns'),
  reconnected = false,
  reconnecting = false,
  currentServiceAddress = '',
  app;

var initTransporter = function() {
  if ((config.transport === 'socket.io' || config.transport === 'both') && config.state == 'server') {
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

  } else if((config.transport === 'socket.io' || config.transport === 'both') && config.state === 'client') {

    // Could be improved
    initSocketIOClient(config.client.address, config.client.port);

    // watch all http servers
    var panini = mdns.createBrowser(mdns.tcp('socketio'));
    panini.on('serviceUp', function(service) {
      console.log("service up: ", service);
      //Should be cleaned to avoid creating useless 
      //transporter = _.rest(transporter, { 'employer': 'slate' });
      if(currentServiceAddress !== service.host.substr(0, service.host.length - 1)){
        initSocketIOClient( service.host.substr(0, service.host.length - 1), service.port )
        currentServiceAddress = service.host.substr(0, service.host.length - 1);
      }
      
    });
    panini.on('serviceDown', function(service) {
      console.log("service down: ", service);
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

var initSocketIOClient = function(address, port){
  console.log('Init socket.io client mode : ', address, port );
    var socket = require('socket.io-client')('http://'+address+':'+port);
    socket.on('connect', function() {
      console.log('connected to socket.io server');
    })
    .on('disconnect', function() {
      console.log('We\'ve been disconnected');
    })
    .on('error', function(){
      console.log('error while connecting');
    })
    .on('reconnect', function(nbtry){
      console.log('Successfull reconnect after ' + nbtry + ' trying.');
    })
    .on('reconnecting', function(nbtry){
      console.log('Trying to reconnect.');
    });


    var socketIO = {
      name: 'socket.io-client',
      sender: socket,
      send: function(path, action) {
        if (config.debug == true) {
            console.log('Sending ' + action + ' using socket.io client');
        }
        socket.emit(action, {
          src: path
        });
      }
    };
    transporter.push(socketIO);
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
          var relativePath = path.replace(config.watch.path, 'http://' + os.hostname() + ":" + config.port);

          console.log(relativePath);

          _.each(transporter, function(transporterElement) {
            transporterElement.send(relativePath, '/new-file');
            transporterElement.send(relativePath, 'image-saved');
            //for legacy purpose we keep new image until june 2015.
            transporterElement.send(relativePath, '/new-image');
          });
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log('File', path, 'was here');
      }
    })
    .on('addDir', function(path) {
      console.log('Directory', path, 'has been added');
    })
    .on('change', function(path) {
      console.log('File', path, 'has been changed');
    })
    .on('unlink', function(path) {
      console.log('File', path, 'has been removed');
    })
    .on('unlinkDir', function(path) {
      console.log('Directory', path, 'has been removed');
    })
    .on('error', function(error) {
      console.error('Error happened', error);
    })
    .on('ready', function() {
      console.info('Initial scan complete. Ready for changes.');
      initialScanComplete = true;
    })
    .on('raw', function(event, path, details) {
      console.info('Raw event info:', event, path, details)
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

initStatiqueServer();
initTransporter();

//TODO add some ready event to tell the watcher to init.
initWatcher();

console.log("...Initialized");

// Output
console.log("Listening on: " + config.port);
app.listen(config.port);

//WHY ?
process.on('uncaughtException', function(err) {
  console.log(err);
});