var debug = require("debug")("TexecomAccessory");
var serialport = require("serialport");
var zpad = require("zpad");
var S = require('string');
var crypto = require("crypto");
var net = require('net');

const EventEmitter = require('events');
class ResponseEmitter extends EventEmitter { }
const responseEmitter = new ResponseEmitter();

var serialPort;
var connection;

var Accessory, Service, Characteristic;

var service_area;

var changed;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-texecom", "Texecom", TexecomAccessory);
    homebridge.registerPlatform("homebridge-texecom", "Texecom", TexecomPlatform);
}

function TexecomPlatform(log, config) {
    this.log = log
    this.serial_device = config["serial_device"];
    this.baud_rate = config["baud_rate"];
    this.zones = config["zones"] || [];
    this.areas = config["areas"] || [];
    this.ip_address = config["ip_address"];
    this.ip_port = config["ip_port"];
    this.udl = config["udl"];
}

TexecomPlatform.prototype = {

    accessories: function (callback) {
        var accessories = [];
        for (var i = 0; i < this.zones.length; i++) {
            var zone = new TexecomAccessory(this.log, this.zones[i], "zone", this.udl, this.serial_device, this.ip_address);
            accessories.push(zone);
        }

        for (var i = 0; i < this.areas.length; i++) {
            var area = new TexecomAccessory(this.log, this.areas[i], "area", this.udl, this.serial_device, this.ip_address);
            accessories.push(area);
        }

        platform = this;

        function processData(data) {
            // Received data is a zone update
            if (S(data).startsWith('"Z')) {

                // Extract the data from the serial line received
                var zone_data = Number(S(S(data).chompLeft('"Z')).left(4).s);
                // Extract the zone number that is being updated
                var updated_zone = Number(S(S(data).chompLeft('"Z')).left(3).s);
                // Is the zone active?
                var zone_active = S(zone_data).endsWith('1');

                platform.log("Zone update received for zone " + updated_zone + " active: " + zone_active);

                for (var i = 0; i < accessories.length; i++) {
                    if (accessories[i].accessoryType === "zone" && accessories[i].zone_number == updated_zone) {
                        platform.log("Zone match found, updating zone status in HomeKit to " + zone_active);
                        accessories[i].changeHandler(zone_active);
                        break;
                    }
                }
            } else if (S(data).startsWith('"A') || S(data).startsWith('"D') || S(data).startsWith('"L')) {

                // Extract the area number that is being updated
                var updated_area = Number(S(S(data).substring(2, 5)));
                var status = S(data).substring(1, 2);
                var stateValue;

                switch (String(status)) {
                    case "L":
                        stateValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
                        platform.log("Area " + updated_area + " triggered");
                        changed = true;
                        break;
                    case "D":
                        stateValue = Characteristic.SecuritySystemCurrentState.DISARMED;
                        platform.log("Area " + updated_area + " disarmed");
                        changed = true;
                        break;
                    case "A":
                        stateValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                        platform.log("Area " + updated_area + " armed");
                        changed = true;
                        break;
                    default:
                        platform.log("Unknown status letter " + status);
                        changed = true;
                        return;
                }
                for (var i = 0; i < accessories.length; i++) {
                    if (accessories[i].accessoryType === "area" && accessories[i].area_number == updated_area) {
                        platform.log("Area match found, updating area status in HomeKit to " + stateValue);
                        accessories[i].changeHandler(stateValue);
                        break;
                    }
                }
            } else {
                platform.log("Unknown string from Texecom: " + S(data));
            }
        }

        if (this.serial_device) {
            var SerialPort = serialport.SerialPort;

            serialPort = new SerialPort(this.serial_device, {
                baudrate: this.baud_rate,
                parser: serialport.parsers.readline("\n")
            });

            serialPort.on("open", function () {
                platform.log("Serial port opened");
                serialPort.on('data', function (data) {
                    platform.log("Serial data received: " + data);
                    responseEmitter.emit('data', data);
                    processData(data);
                });
            });
        } else if (this.ip_address) {
            try {
                connection = net.createConnection(platform.ip_port, platform.ip_address, function () {
                    platform.log('Connected via IP');
                });
            } catch (err) {
                platform.log(err);
            }
            connection.on('data', function (data) {
                platform.log("IP data received: " + data);
                responseEmitter.emit('data', data);
                processData(data);
            });
            connection.on('end', function () {
                platform.log('IP connection ended');
            });

            connection.on('close', function () {
                platform.log('IP connection closed');
                try {
                    connection = net.createConnection(platform.ip_port, platform.ip_address, function () {
                        platform.log('Re-connected after loss of connection');
                    });
                } catch (err) {
                    platform.log(err);
                }
            });
        } else {
            this.log("Must set either serial_device or ip_address in configuration.");
        }

        callback(accessories);
    }
}

function TexecomAccessory(log, config, accessoryType, udl, serial_device, ip_address) {
    this.log = log;
    this.accessoryType = accessoryType;
    this.udl = udl;
    this.serial_device = serial_device;
    this.ip_address = ip_address;

    if (accessoryType === "zone") {
        this.zone_number = zpad(config["zone_number"], 3);
        this.name = config["name"];
        this.zone_type = config["zone_type"] || "motion";
        this.dwell_time = config["dwell"] || 0;
    } else if (accessoryType === "area") {
        this.area_number = zpad(config["area_number"], 3);
        this.name = config["name"];
        this.zone_type = config["area_type"] || "securitysystem";
        this.dwell_time = config["dwell"] || 0;
    }

    if (config["sn"]) {
        this.sn = config["sn"];
    } else {
        var shasum = crypto.createHash('sha1');
        shasum.update(this.zone_number || this.area_number);

        this.sn = shasum.digest('base64');
        log('Computed SN ' + this.sn);
    }
}

TexecomAccessory.prototype = {

    getServices: function () {

        var service, changeAction;

        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
            .setCharacteristic(Characteristic.Model, "Texecom " + (this.accessoryType === "zone" ? "Zone" : "Area"))
            .setCharacteristic(Characteristic.SerialNumber, this.sn);


        if (this.accessoryType === "zone") {
            switch (this.zone_type) {
                case "contact":
                    service = new Service.ContactSensor();
                    changeAction = function (newState) {
                        service.getCharacteristic(Characteristic.ContactSensorState)
                            .setValue(newState ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
                    };
                    break;
                case "motion":
                    service = new Service.MotionSensor();
                    changeAction = function (newState) {
                        service.getCharacteristic(Characteristic.MotionDetected)
                            .setValue(newState);
                    };
                    break;
                case "smoke":
                    service = new Service.SmokeSensor();
                    changeAction = function (newState) {
                        service.getCharacteristic(Characteristic.SmokeDetected)
                            .setValue(newState ? Characteristic.ContactSensorState.SMOKE_DETECTED : Characteristic.ContactSensorState.SMOKE_NOT_DETECTED);
                    };
                    break;
                case "carbonmonoxide":
                    service = new Service.CarbonMonoxideSensor();
                    changeAction = function (newState) {
                        service.getCharacteristic(Characteristic.CarbonMonoxideDetected)
                            .setValue(newState ? Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
                    };
                    break;
                default:
                    service = new Service.MotionSensor();
                    changeAction = function (newState) {
                        service.getCharacteristic(Characteristic.MotionDetected)
                            .setValue(newState);
                    };
                    break;
            }
        } else if (this.accessoryType === "area") {
            service = new Service.SecuritySystem();
            changeAction = function (newState) {
                service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
                    .setValue(newState);
                service.getCharacteristic(Characteristic.SecuritySystemTargetState)
                    .setValue(newState);
            };
            changeAction(Characteristic.SecuritySystemCurrentState.DISARMED); // startup default
        }

        this.changeHandler = function (status) {
            var newState = status;
            platform.log("Dwell = " + this.dwell_time);

            if (!newState && this.dwell_time > 0) {
                this.dwell_timer = setTimeout(function () { changeAction(newState); }.bind(this), this.dwell_time);
            } else {
                if (this.dwell_timer) {
                    clearTimeout(this.dwell_timer);
                }
                changeAction(newState);
            }

            platform.log("Changing state with changeHandler to " + newState);

        }.bind(this);


        if (this.accessoryType === "area") {
            service.getCharacteristic(Characteristic.SecuritySystemTargetState)
                .on('set', function (value, callback) {
                    if (changed) {
                        changed=false;
                    }
                    else {
                        service_area = service;
                        this.setTargetState(parseInt(this.area_number, 10), value, callback);
                    }
                }.bind(this));
        }


        return [informationService, service];
    },

    setTargetState: function (areaNumber, value, callback) {

        const hexMapping = {
            '1': 0x01,
            '2': 0x02,
            '3': 0x04,
            '4': 0x08,
            '5': 0x10,
            '6': 0x20,
            '7': 0x40,
            '8': 0x80
        };


        this.log("Setting target state for area " + areaNumber + " to " + value);

        var command;
        switch (value) {
            case Characteristic.SecuritySystemTargetState.STAY_ARM:
                command = "\\Y" + String.fromCharCode(parseInt(hexMapping[areaNumber], 16)) + "/"; // Home
                break;
            case Characteristic.SecuritySystemTargetState.AWAY_ARM:
                command = "\\A" + String.fromCharCode(parseInt(hexMapping[areaNumber], 16)) + "/"; // Away arm
                break;
            case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                command = "\\Y" + String.fromCharCode(parseInt(hexMapping[areaNumber], 16)) + "/"; // Night arm
                break;
            case Characteristic.SecuritySystemTargetState.DISARM:
                command = "\\D" + String.fromCharCode(parseInt(hexMapping[areaNumber], 16)) + "/"; // Disarm
                break;
            default:
                this.log("Unknown target state: " + value);
                callback(new Error("Unknown target state"));
                return;
        }

        //this.updateCurrentState(value);

        if (this.serial_device) {
            writeCommandAndWaitForOKS("\\W" + this.udl + "/")
                .then(() => writeCommandAndWaitForOKS(command))
                .then(() => {
                    this.updateCurrentState(value);
                    callback(); // Successful execution

                })
                .catch((err) => {
                    callback(err); // Handle errors
                });
        } else if (this.ip_address) {
            writeCommandAndWaitForOK("\\W" + this.udl + "/")
                .then(() => writeCommandAndWaitForOK(command))
                .then(() => {
                    this.updateCurrentState(value);
                    callback(); // Successful execution
                })
                .catch((err) => {
                    callback(err); // Handle errors
                });
        }
        else {

            this.log("No serial device or IP address configured");
            callback(new Error("No serial device or IP address configured"));
        }

    },

    updateCurrentState: function (newState) {
        // Update the current state of the accessory here
        const currentState = this.convertTargetStateToCurrentState(newState);

        this.log("Updating current state to: " + currentState);
        if (service_area) {

            service_area
                .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                .updateValue(currentState);

            // Optionally, update the target state to match the current state
            /*service_area
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .updateValue(currentState);*/
        } else {
            this.log("Error: Service not initialized.");
        }
    },

    convertTargetStateToCurrentState: function (targetState) {
        switch (targetState) {
            case Characteristic.SecuritySystemTargetState.STAY_ARM:
                return Characteristic.SecuritySystemCurrentState.STAY_ARM;
            case Characteristic.SecuritySystemTargetState.AWAY_ARM:
                return Characteristic.SecuritySystemCurrentState.AWAY_ARM;
            case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                return Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
            case Characteristic.SecuritySystemTargetState.DISARM:
                return Characteristic.SecuritySystemCurrentState.DISARMED;
            default:
                this.log("Unknown target state: " + targetState);
                return Characteristic.SecuritySystemCurrentState.DISARMED;
        }
    }
};

function writeCommandAndWaitForOK(command, callback) {
    return new Promise((resolve, reject) => {
        connection.write(command, function (err) {
            if (err) {
                platform.log("Error writing to IP connection: " + err);
                reject(err);
            } else {
                platform.log("Command sent to IP connection: " + command);
            }
        });

        function handleData(data) {
            if (data.toString().trim() === 'OK') {
                responseEmitter.removeListener('data', handleData);
                resolve();
            }
        }

        responseEmitter.on('data', handleData);
    });
}

function writeCommandAndWaitForOKS(command, callback) {
    return new Promise((resolve, reject) => {
        serialPort.write(command, function (err) {
            if (err) {
                platform.log("Error writing to IP connection: " + err);
                reject(err);
            } else {
                platform.log("Command sent to IP connection: " + command);
            }
        });

        function handleData(data) {
            if (data.toString().trim() === 'OK') {
                responseEmitter.removeListener('data', handleData);
                resolve();
            }
        }

        responseEmitter.on('data', handleData);
    });
}