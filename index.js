var Service;
var Characteristic;
var debug = require("debug")("TexecomAccessory");
var serialport = require("serialport");
var zpad = require("zpad");
var S = require('string');
var crypto = require("crypto");
var net = require('net');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-texecom", "Texecom", TexecomAccessory);
    homebridge.registerPlatform("homebridge-texecom", "Texecom", TexecomPlatform);
}

function TexecomPlatform(log, config){
    this.log = log;
    this.serial_device = config["serial_device"];
    this.baud_rate = config["baud_rate"];
    this.zones = config["zones"] || [];
	this.ip_address = config["ip_address"];
	this.ip_port = config["ip_port"];
}

TexecomPlatform.prototype = {

    accessories: function(callback) {
        var zoneAccessories = [];
        for(var i = 0; i < this.zones.length; i++){
            var zone = new TexecomAccessory(this.log, this.zones[i]);
            zoneAccessories.push(zone);
        }
        var zoneCount = zoneAccessories.length;
        callback(zoneAccessories);

		function processData(data) {
			// Received data is a zone update
			if(S(data).contains('Z')){

				// Extract the data from the serial line received
				var zone_data = Number(S(S(data).chompLeft('"Z')).left(4).s);
				// Extract the zone number that is being updated
				var updated_zone = Number(S(S(data).chompLeft('"Z')).left(3).s);
				// Is the zone active?
				var zone_active = S(zone_data).endsWith('1');

				debug("Zone update received for zone " + updated_zone);
				debug("Zone active: " + zone_active);

				for(var i = 0; i < zoneCount; i++){
					if(zoneAccessories[i].zone_number == updated_zone){
						debug("Zone match found, updating zone status in HomeKit to " + zone_active);
						zoneAccessories[i].changeHandler(zone_active);
						break;
					}
				}

			}
		}

		if (this.serial_device) {        
			var SerialPort = serialport.SerialPort; 

			var serialPort = new SerialPort(this.serial_device, {
				baudrate: this.baud_rate,
				parser: serialport.parsers.readline("\n")
			});
		
			serialPort.on("open", function () {
				debug("Serial port opened");
				serialPort.on('data', function(data) {
					debug("Serial data received: " + data);
					processData(data);
				});
			});
		} else if (this.ip_address) {
			platform = this;
			try {
				connection = net.createConnection(this.ip_port, this.ip_address, function() {
					platform.log('Connected via IP');
				});
			} catch (err) {
				platform.log(err);
			}
			connection.on('data', function(data) {
				platform.log("received data");
				debug("IP data received: " + data);
				processData(data);
			});
			connection.on('end', function() {
				platform.log('IP connection ended');
			});

			connection.on('close', function() {
				platform.log('IP connection closed');
				try {
					connection = net.createConnection(this.ip_port, this.ip_address, function() {
						platform.log('Re-connected after loss of connection');
					});
				} catch (err) {
					platform.log(err);
				}
			});
		} else {
			this.log("Must set either serial_device or ip_address in configuration.");
		}
    }
}

function TexecomAccessory(log, zoneConfig) {
    this.log = log;

    this.zone_number = zpad(zoneConfig["zone_number"], 3);
    this.name = zoneConfig["name"];
    this.zone_type = zoneConfig["zone_type"] || "motion";
    this.dwell_time = zoneConfig["dwell"] || 0;

    if(zoneConfig["sn"]){
        this.sn = zoneConfig["sn"];
    } else {
        var shasum = crypto.createHash('sha1');
        shasum.update(this.zone_number);
        this.sn = shasum.digest('base64');
        debug('Computed SN ' + this.sn);
    }
}

TexecomAccessory.prototype = {

    getServices: function() {

        var informationService = new Service.AccessoryInformation();

        informationService
          .setCharacteristic(Characteristic.Name, this.name)
          .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
          .setCharacteristic(Characteristic.Model, "Texecom Zone")
          .setCharacteristic(Characteristic.SerialNumber, this.sn);

        var service, changeAction;
        switch(this.zone_type){
        case "contact":
            service = new Service.ContactSensor();
            changeAction = function(newState){
                service.getCharacteristic(Characteristic.ContactSensorState)
                        .setValue(newState ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
            };
            break;
        case "motion":
            service = new Service.MotionSensor();
            changeAction = function(newState){
                service.getCharacteristic(Characteristic.MotionDetected)
                        .setValue(newState);
            };
            break;
        case "smoke":
            service = new Service.SmokeSensor();
            changeAction = function(newState){
                service.getCharacteristic(Characteristic.SmokeDetected)
                        .setValue(newState ? Characteristic.ContactSensorState.SMOKE_DETECTED : Characteristic.ContactSensorState.SMOKE_NOT_DETECTED);
            };
            break;
        case "carbonmonoxide":
            service = new Service.CarbonMonoxideSensor();
            changeAction = function(newState){
                service.getCharacteristic(Characteristic.CarbonMonoxideDetected)
                        .setValue(newState ? Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
            };
            break;
        default:
        	service = new Service.MotionSensor();
            changeAction = function(newState){
                service.getCharacteristic(Characteristic.MotionDetected)
                        .setValue(newState);
            };
            break;
        }

        this.changeHandler = function(status){
            var newState = status;
            debug("Dwell = " + this.dwell_time);
            
            if(!newState && this.dwell_time > 0){
            	this.dwell_timer = setTimeout(function(){ changeAction(newState); }.bind(this), this.dwell_time);
            } else {
            	if(this.dwell_timer){
            		clearTimeout(this.dwell_timer);
            	}
            	changeAction(newState);
            }
            
            debug("Changing state with changeHandler to " + newState);
            
        }.bind(this);

        return [informationService, service];
    }
};
