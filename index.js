var Service;
var Characteristic;
var debug = require("debug")("TexecomAccessory");
var serialport = require("serialport");
var zpad = require("zpad");
var S = require('string');
var crypto = require("crypto");
var net = require('net');

const EventEmitter = require('events');
class ResponseEmitter extends EventEmitter { }
const responseEmitter = new ResponseEmitter();

var setByAlarm = false;

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
    this.udl = config["udl"];
    this.zones = config["zones"] || [];
    this.areas = config["areas"] || [];
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
        
        var areaAccessories = [];
        for(var i = 0; i < this.areas.length; i++){
            var area = new TexecomAccessory(this.log, this.areas[i]);
            areaAccessories.push(area);
        }
        var areaCount = areaAccessories.length;

        callback(zoneAccessories.concat(areaAccessories));
		platform = this;

		function processData(data) {
			// Received data is a zone update
			if(S(data).startsWith('"Z')){

				// Extract the data from the serial line received
				var zone_data = Number(S(S(data).chompLeft('"Z')).left(4).s);
				// Extract the zone number that is being updated
				var updated_zone = Number(S(S(data).chompLeft('"Z')).left(3).s);
				// Is the zone active?
				var zone_active = S(zone_data).endsWith('1');

				platform.log("Zone update received for zone " + updated_zone + " active: " + zone_active);

				for(var i = 0; i < zoneCount; i++){
					if(zoneAccessories[i].zone_number == updated_zone){
						platform.log.debug("Zone match found, updating zone status in HomeKit to " + zone_active);
						zoneAccessories[i].changeHandler(zone_active);
						break;
					}
				}
				
			} else if (S(data).startsWith('"A') || S(data).startsWith('"D') || S(data).startsWith('"L')){
				
				// Extract the area number that is being updated
				var updated_area = Number(S(S(data).substring(2,5)));
				var status = S(data).substring(1,2);
				var stateValue;
				
				switch (String(status)) {
            	case "L":
            		stateValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
					platform.log("Area " + updated_area + " triggered");
            		break;
            	case "D":
            		stateValue = Characteristic.SecuritySystemCurrentState.DISARMED;
					platform.log("Area " + updated_area + " disarmed");
            		break;
            	case "A":
            		stateValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
					platform.log("Area " + updated_area + " armed");
            		break;
            	default:
            		platform.log("Unknown status letter " + status);
            		return;
            	}
				
				for(var i = 0; i < areaCount; i++){
					if(areaAccessories[i].zone_number == updated_area){
						platform.log.debug("Area match found, updating area status in HomeKit to " + stateValue);
                                                setByAlarm = true;
						areaAccessories[i].changeHandler(stateValue);
						break;
					}
				}
				
			} else {
				platform.log.debug("Unknown string from Texecom: " + S(data));
			}
		}

		if (this.serial_device) {        
			var SerialPort = serialport.SerialPort; 

			var serialPort = new SerialPort(this.serial_device, {
				baudrate: this.baud_rate,
				parser: serialport.parsers.readline("\n")
			});
		
			serialPort.on("open", function () {
				platform.log("Serial port opened");
				serialPort.on('data', function(data) {
					platform.log.debug("Serial data received: " + data);
                                        responseEmitter.emit('data', data);
					processData(data);
				});
			});  

                        this.texecomConnection = serialPort;
		} else if (this.ip_address) {
			try {
				connection = net.createConnection(platform.ip_port, platform.ip_address, function() {
					platform.log('Connected via IP');
				});
			} catch (err) {
				platform.log(err);
			}
                        connection.setNoDelay(true);
			connection.on('data', function(data) {
				platform.log.debug("IP data received: " + data);
                                responseEmitter.emit('data', data);
				processData(data);
			});
			connection.on('end', function() {
				platform.log('IP connection ended');
			});

			connection.on('close', function() {
				platform.log('IP connection closed');
				try {
					connection = net.createConnection(platform.ip_port, platform.ip_address, function() {
						platform.log('Re-connected after loss of connection');
					});
				} catch (err) {
					platform.log(err);
				}
			});

                        this.texecomConnection = connection;
		} else {
			this.log("Must set either serial_device or ip_address in configuration.");
		}
    }
}

function TexecomAccessory(log, zoneConfig) {
    this.log = log;

    this.zone_number = zpad(zoneConfig["zone_number"] || zoneConfig["area_number"], 3);
    this.name = zoneConfig["name"];
    this.zone_type = zoneConfig["zone_type"] || zoneConfig["area_type"] || "motion";
    this.dwell_time = zoneConfig["dwell"] || 0;

    if(zoneConfig["sn"]){
        this.sn = zoneConfig["sn"];
    } else {
        var shasum = crypto.createHash('sha1');
        shasum.update(this.zone_number);
        
        this.sn = shasum.digest('base64');
        log.debug('Computed SN ' + this.sn);
    }
}

TexecomAccessory.prototype = {

    getServices: function() {
        const me = this;
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
        case "securitysystem":
            service = new Service.SecuritySystem();
            changeAction = function(newState){
                var targetState; 
                switch (newState) {
                case Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
                    targetState = Characteristic.SecuritySystemTargetState.NIGHT_ARM;
                    break;
                case Characteristic.SecuritySystemCurrentState.AWAY_ARM:
                    targetState = Characteristic.SecuritySystemTargetState.AWAY_ARM;
                    break;
                case Characteristic.SecuritySystemCurrentState.STAY_ARM:
                    targetState = Characteristic.SecuritySystemTargetState.STAY_ARM;
                    break;
                case Characteristic.SecuritySystemCurrentState.DISARMED:
                    targetState = Characteristic.SecuritySystemTargetState.DISARM;
                    break;
                default:
                    targetState = null; // alarm triggered has no corresponding target state
                    break;
                }
                service.getCharacteristic(Characteristic.SecuritySystemCurrentState).setValue(newState);
                if (targetState != null) {
                    service.getCharacteristic(Characteristic.SecuritySystemTargetState).setValue(targetState);
                }
                me.log("Set target state " + targetState + " and current state " + newState + " in response to notification from alarm");
            };

            // we don't know the alarm's state at startup, safer to assume disarmed:
            changeAction(Characteristic.SecuritySystemCurrentState.DISARMED);

            var area = this;

            service.getCharacteristic(Characteristic.SecuritySystemTargetState)
                .on('set', function (value, callback) {
                    if (setByAlarm) {
                        platform.log("Not sending command to alarm for change to state " + value + " because the state change appears to have come from the alarm itself.");
                        setByAlarm = false;
                        return;
                    }
                    if (platform.udl != null) {
                        areaTargetSecurityStateSet(platform, area, service, value, callback);
                    } else {
                        platform.log("No UDL configured. Add your UDL to enable arm/disarm from HomeKit.");
                        callback(new Error("No UDL configured"));
                    }
                });
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
            platform.log.debug("Dwell = " + this.dwell_time);
            
            if(!newState && this.dwell_time > 0){
            	this.dwell_timer = setTimeout(function(){ changeAction(newState); }.bind(this), this.dwell_time);
            } else {
            	if(this.dwell_timer){
            		clearTimeout(this.dwell_timer);
            	}
            	changeAction(newState);
            }
            
            platform.log.debug("Changing state with changeHandler to " + newState);
            
        }.bind(this);

        return [informationService, service];
    }
};

function areaTargetSecurityStateSet(platform, accessory, service, value, callback) {
    var area_number = String.fromCharCode(accessory.zone_number);
    // thanks to @K1LL3R234 for contributing arm/disarm function:
    var command;
    switch (value) {
        case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
            command = "Y" + area_number; 
            break;
        case Characteristic.SecuritySystemTargetState.AWAY_ARM:
            command = "A" + area_number;
            break;
        case Characteristic.SecuritySystemTargetState.STAY_ARM:
        case Characteristic.SecuritySystemTargetState.DISARM:
            command = "D" + area_number;
            break;
        default:
            this.log("Unknown target state: " + value);
            callback(new Error("Unknown target state"));
            return;
    }

    platform.log("Sending arm/disarm command " + value + " to area " + accessory.zone_number);

    writeCommandAndWaitForOK(platform.texecomConnection, "W" + platform.udl)
        .then(() => writeCommandAndWaitForOK(platform.texecomConnection, command))
        .then(() => {
            // OK response from alarm is only indication that the target state has been reached
            var currentState;
            switch (value) {
            case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                currentState = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                break;
            case Characteristic.SecuritySystemTargetState.AWAY_ARM:
                currentState = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                break;
            case Characteristic.SecuritySystemTargetState.STAY_ARM:
                currentState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                break;
            case Characteristic.SecuritySystemTargetState.DISARM:
                currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
                break;
            default:
                platform.log("Unknown target alarm state " + value);
                callback(new Error("Unknown target state"));
                return;
            }
            platform.log("Setting current status of area " + accessory.zone_number + " to " + currentState + " because alarm responded OK");
            service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
                        .setValue(currentState);
            callback();
        })
        .catch((err) => {
            platform.log("Callback with error " + err);
            callback(err); // Handle errors
    });
}

function writeCommandAndWaitForOK(connection, command) {
    return new Promise((resolve, reject) => {
        function handleData(data) {
            if (data.toString().trim() === 'OK') {
                responseEmitter.removeListener('data', handleData);
                resolve();
            }
        }

        responseEmitter.on('data', handleData);

        connection.write("\\" + command + "/", function (err) {
            if (err) {
                platform.log("Error writing to connection: " + err);
                reject(err);
            } else {
                platform.log("Command sent: " + command);
            }
        });

        setTimeout(() => {
            responseEmitter.removeListener('data', handleData);
            reject(new Error("Timeout"));
        }, 2000);
    });
}
