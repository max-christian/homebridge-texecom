var Service;
var Characteristic;
var debug = require("debug")("TexecomAccessory");
var serialport = require("serialport");
var zpad = require("zpad");
var S = require('string');
var crypto = require("crypto");

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
        
        var SerialPort = serialport.SerialPort; 

		var serialPort = new SerialPort(this.serial_device, {
  			baudrate: this.baud_rate,
  			parser: serialport.parsers.readline("\n")
		});
		
		serialPort.on("open", function () {
  			console.log("Serial port opened");
  			serialPort.on('data', function(data) {
    			console.log("Serial data received: " + data);
    			// Received data is a zone update
    			if(S(data).contains('Z')){
    				var zone_data = Number(S(S(data).chompLeft('"Z')).left(4).s);
    				var updated_zone = Number(S(S(data).chompLeft('"Z')).left(3).s);
    				var zone_active = S(zone_data).endsWith('1');
    				console.log("Zone update received for zone " + updated_zone);
    				console.log("Zone active: " + zone_active);
    				
    				for(var i = 0; i < zoneCount; i++){
    					if(zoneAccessories[i].zone_number == updated_zone){
    						console.log("Zone match found, updating zone status in HomeKit to " + zone_active);
    						zoneAccessories[i].changeHandler(zone_active);
    					}
    				}
    				
    			}
  			});
		});

    }
}

function TexecomAccessory(log, zoneConfig) {
    this.log = log;

    this.zone_number = zpad(zoneConfig["zone_number"], 3);
    this.name = zoneConfig["name"];
    this.window_seconds = zoneConfig["window_seconds"] || 62;
    this.zone_type = zoneConfig["zone_type"] || "motion";

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
            var d = new Date();
            var newState = status;
            console.log("Changing state with changeHandler to " + newState);
            changeAction(newState);
        }.bind(this);

        return [informationService, service];
    }
};
