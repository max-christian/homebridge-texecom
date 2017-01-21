# homebridge-texecom

A plugin for [Homebridge](https://github.com/nfarina/homebridge) that creates HomeKit motion, contact, smoke, or carbon monoxide sensors for alarm zones from a Texecom Premier intruder alarm via a serial connection. 

**IMPORTANT** - To use this plugin you will require a Texecom alarm system and a PC-COM or USB-COM serial interface. You must also have nothing already utilising COM1 on the alarm panel,  or be able to move existing modules connected to COM1 to a different COM port on the alarm panel. This plugin DOES NOT currently support IP communication, only serial.

## Configuration

Texecom zones must be configured individually in the Homebridge config.json file with the appropriate zone number from Texecom.

Example:

    "platforms": [
        {
    		"platform": "Texecom",
        	"serial_device": "/dev/ttyUSB0",
        	"baud_rate": 19200,
        	"zones": [
            	{
                	"name": "Living Room",
                	"zone_number": "7",
                	"zone_type": "motion"
            	}
            	,
            	{
                	"name": "Front Door",
                	"keyword": "15",
                	"zone_type": "contact"
            	}
            ]
        }
    ]
    


### Global Configuration

| Key | Default | Description |
| --- | --- | --- |
| `serial_device` | N/A | The serial device on which to connect to Texecom |
| `baud_rate` | N/A | The baud rate configured in Texecom (Usually 19200) |
| `zones` | N/A | The individual configuration for each zone in Texecom |

### Per-zone Configuration

This plugin is a platform plugin so you must configure each zone from your Texecom intruder alarm into your config individually.

| Key | Default | Description |
| --- | --- | --- |
| `name` | N/A | The name of the sensor as it will appear in HomeKit. |
| `zone_number` | N/A | The zone number from Texecom |
| `zone_type` | `"motion"` | The type of zone; motion, contact, smoke, or carbonmonoxide |

## Configuring Texecom

Ensure your intruder alarm is fully configured and operational, connect a USB-Com or PC-Com cable to COM1 on the panel PCB and then connect to the computer running Homebridge.

To configure your COM1 port for the Crestron protocol:

1. Enter your engineer code
2. Scroll until you find "UDL/Digi Options"
3. Press 8 to jump to "Com Port Setup"
4. Scroll to "Com Port 1"
5. Press "No" to edit the port
6. Press 8 to jump to "Crestron System"
7. Press "Yes" to confirm and save.

Press "Menu" repeatedly to exit the engineer menu.

This plugin DOES NOT currently support IP communication.

## Future features

Alarm systems are complicated and have a lot of features, not all them are suitable for integrating to HomeKit but many of them can be integrated.

* **Alarm system services** - Currently this plugin only integrates the zone sensors themselves. In the future the alarm system status itself will be integrated to show intruder alarm status.
* **Panic buttons** - Investigate the possibility of integrating the medical, panic, and fire buttons into HomeKit as buttons/switches to manually trigger those alerts.
* **IP integration** - Texecom have an ComIP product, however they have announced a Connect Hub product that features an API and other features specifically designed for home automation. Rather than integrate the legacy ComIP module it is better to wait until the release of the Connect Hub and API.
