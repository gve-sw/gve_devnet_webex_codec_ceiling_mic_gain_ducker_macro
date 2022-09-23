# GVE Devnet Webex Codec Ceiling Mic Gain Ducker Macro
Webex Codec macro to automatically duck the ceiling mic gain levels while another amplified microphone connected to the same codec is being used and the speakers for the room are also mounted on the ceiling. 


## Contacts
* Gerardo Chaves (gchaves@cisco.com)
* Enrico Conedera (econeder@cisco.com)

## Solution Components
* Webex Collaboration Endpoints
*  Javascript
*  xAPI

## Related Sandbox Environment

This sample code can be tested using a Cisco dCloud demo instance that contains ** Webex Room devices with multiple mic inputs **

## Requirements
* Cisco Room series devices running RoomOS 10.8 or later

## Installation/Configuration

Install the GMM_Lib macro on the codec since this ducker macro depends on it. Do not activate it.  

Copy the contents of the *ceiling_mic_ducker.js* file into a new macro on the RoomOS device.
Then, edit the following constant arrays to match your configuration: 

MICROPHONE_CONNECTORS: Overall Microphone Input Numbers to Monitor  
Specify the input connectors associated to the microphones being used in the room  
For example, if you set the value of MICROPHONE_CONNECTORS to [1,2,3,4,5,6,7,8] the macro will evaluate mic input id's 1-8 for its ducking logic
const MICROPHONE_CONNECTORS = [1,2,3,4,5,6,7,8];  

AMPLIFIED_MIC_CONNECTORS: Input number corresponding to amplified microphones in the room  
These should be a subset of MICROPHONE_CONNECTORS and cannot contain any IDs used in CEILING_MIC_CONNECTORS constant array.  
For example, if you set the value of AMPLIFIED_MIC_CONNECTORS to [1,2] the macro will duck the gain on the ceiling microphones
connected to the inputs specified in the CEILING_MIC_CONNECTORS array whenever microphones with ID 1 or 2 are actively being used.  

CEILING_MIC_CONNECTORS: Input number corresponding to ceiling microphones in the room
These should be a subset of MICROPHONE_CONNECTORS and cannot contain any IDs used in AMPLIFIED_MIC_CONNECTORS constant array.  
For example, if you set the value of CEILING_MIC_CONNECTORS to [5,6,7,8] the macro will duck the gain on microphones connected 
with those IDs when it detects activity of the amplified microphones specified in AMPLIFIED_MIC_CONNECTORS.  

You might also want to edit the following constants as you perform testing with the various microphone 
levels in your room to obtain an optimal experience:  


DUCKING_VALUE: This specifies the value to use to subtrack or "duck" from the configured ceiling microphones input level while an amplified mic 
is in use. Default is set to 7 but you must experiment to make sure the value is high enough so that while the amplified mics are being 
used the sound from the amplified speakers is not fed back into those ceiling mics.

FADE_IN_STEP: This the "Speed" of fade in of the ceiling mics after there is no more activity on the amplified mics. It is specified in dB per VUmeter 'ticks' and 
the default value is 3. A value of 1 means a very slow, smooth fade in whereas a value of 6 provides a very quick fade in experience. 

ATTACK_NUM_THRESHOLD: This is the number of consecutive VUmeter events with noise level above the threshold that indicates that the amplified 
mics are being used before starting to duck the ceiling mic levels. Default is set to 3. Set it to a lower level if you want the duck to start 
faster. 

RELEASE_NUM_THRESHOLD: This is the number of consecutive VUmeter events with noise level below the threshold that indicates that the amplified 
mics are no longer being used before fading back in the ceiling mic levels. Default is set to 3. Set it to a lower level if you want the fading in 
to occur faster.  

SHOW_DUCKING_ALERT: Set this constant to true if you wish to show an alert on the Touch10 or Navigator device every time the macro 
starts ducking the ceiling mics. Useful for initial setup and troubleshooting.  


## Usage

Once the macro has been configured and the constants described above are set, just activate the macro and it will automatically 
duck the values on the ceiling leveles when the amplified microphones are being used during a call.  

The first time the macro runs or after you make any changes in the AMPLIFIED_MIC_CONNECTORS constant, you will see messages
 in the Touch10 or Navigator interface of the device indicating that a first time setup of persistent memory variables is being
 set up. This is to capture the original mic gain values of the ceiling microphones in case the macro is stopped mid-ducking and 
 the gain remains at a lower level. Once you re-start the macro, the original values will be restored before attempting to duck
 gains the next time the amplified mics are used in a call.  

You will also see a new "Memory_Storage" macro that was created automatically during the first time setup of this macro unles another
 macro in the device uses the same "persistent" memory storage mechanism in which case it will already be there and this macro will
 just add a new key to it. 



### LICENSE

Provided under Cisco Sample Code License, for details see [LICENSE](LICENSE.md)

### CODE_OF_CONDUCT

Our code of conduct is available [here](CODE_OF_CONDUCT.md)

### CONTRIBUTING

See our contributing guidelines [here](CONTRIBUTING.md)

#### DISCLAIMER:
<b>Please note:</b> This script is meant for demo purposes only. All tools/ scripts in this repo are released for use "AS IS" without any warranties of any kind, including, but not limited to their installation, use, or performance. Any use of these scripts and tools is at your own risk. There is no guarantee that they have been through thorough testing in a comparable environment and we are not responsible for any damage or data loss incurred with their use.
You are responsible for reviewing and testing any scripts you run thoroughly before use in any non-testing environment.