/*
Copyright (c) 2022 Cisco and/or its affiliates.
This software is licensed to you under the terms of the Cisco Sample
Code License, Version 1.1 (the "License"). You may obtain a copy of the
License at
               https://developer.cisco.com/docs/licenses
All use of the material herein must be in accordance with the terms of
the License. All rights not expressly granted by the License are
reserved. Unless required by applicable law or agreed to separately in
writing, software distributed under the License is distributed on an "AS
IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
or implied.
*/


/////////////////////////////////////////////////////////////////////////////////////////
// REQUIREMENTS
/////////////////////////////////////////////////////////////////////////////////////////

const xapi = require('xapi');
import { GMM } from './GMM_Lib'

/////////////////////////////////////////////////////////////////////////////////////////
// CONSTANTS/ENUMS
/////////////////////////////////////////////////////////////////////////////////////////


// Microphone High/Low Thresholds
const AMPMICROPHONELOW  = 20;
const AMPMICROPHONEHIGH = 40;



// MICROPHONE_CONNECTORS: Overall Microphone Input Numbers to Monitor
// Specify the input connectors associated to the microphones being used in the room
// For example, if you set the value of MICROPHONE_CONNECTORS to [1,2,3,4,5,6,7,8] the macro will evaluate mic input id's 1-8 for its ducking logic
const MICROPHONE_CONNECTORS = [1,2,3,4,5,6,7,8];

// AMPLIFIED_MIC_CONNECTORS: Input number corresponding to amplified microphones in the room
// these should be a subset of MICROPHONE_CONNECTORS and cannot contain any IDs used in CEILING_MIC_CONNECTORS constant array
const AMPLIFIED_MIC_CONNECTORS = [5,6];

//  CEILING_MIC_CONNECTORS: Input number corresponding to ceiling microphones in the room
// these should be a subset of MICROPHONE_CONNECTORS and cannot contain any IDs used in AMPLIFIED_MIC_CONNECTORS constant array
const CEILING_MIC_CONNECTORS = [1,2,3,4];

// Amount to duck mics
const DUCKING_VALUE            = 7;

// "Speed" of fade_in after release, in dB per VUmeter 'tick'
// 1 means a very slow, smooth fade_in
// 6 is quite quick
const FADE_IN_STEP = 3;

// Number of consecutive VUmeter events above atack threshold before ducking
const ATTACK_NUM_THRESHOLD = 3;

// Number of consecutive VUmeter levels below release threshold before uncovering
const RELEASE_NUM_THRESHOLD = 3;

// Show an alert on the Touch10 or Navigator device every time the macro 
// starts ducking the ceiling mics. Useful for initial setup and troubleshooting
const SHOW_DUCKING_ALERT = false;

/*
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
+ DO NOT EDIT ANYTHING BELOW THIS LINE                                  +
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
*/

/////////////////////
// MIC MAPPING VALIDATION
/////////////////////

async function validate_mappings() {
    if (!MICROPHONE_CONNECTORS.every(val => [1,2,3,4,5,6,7,8].includes(val))) {
        let message = { Error: 'Ducker macro disabled', Message: 'MICROPHONE_CONNECTORS has to be a subset of [1,2,3,4,5,6,7,8]. Please correct and try again.' }
        monitorOnAutoError(message);
    }
    // checking length of mapping arrays
    if ((MICROPHONE_CONNECTORS.length <= AMPLIFIED_MIC_CONNECTORS.length)
        || (MICROPHONE_CONNECTORS.length <= CEILING_MIC_CONNECTORS.length)) {
        let message = { Error: 'Ducker macro disabled', Message: 'There cannot be more amplified or ceiling mic sources than total mic sources being monitored. Please correct and try again.' }
        monitorOnAutoError(message);
    }
    if (!AMPLIFIED_MIC_CONNECTORS.every(val => MICROPHONE_CONNECTORS.includes(val))) {
        let message = { Error: 'Ducker macro disabled', Message: 'AMPLIFIED_MIC_CONNECTORS has to be a subset of MICROPHONE_CONNECTOR. Please correct and try again.' }
        monitorOnAutoError(message);
    }
    if (!CEILING_MIC_CONNECTORS.every(val => MICROPHONE_CONNECTORS.includes(val))) {
        let message = { Error: 'Ducker macro disabled', Message: 'CEILING_MIC_CONNECTORS has to be a subset of MICROPHONE_CONNECTORS. Please correct and try again.' }
        monitorOnAutoError(message);
    }
    if (AMPLIFIED_MIC_CONNECTORS.some(item => CEILING_MIC_CONNECTORS.includes(item))) {
        let message = { Error: 'Ducker macro disabled', Message: 'CEILING_MIC_CONNECTORS cannot have elements in common with AMPLIFIED_MIC_CONNECTORS. Please correct and try again.' }
        monitorOnAutoError(message);
    }
}

validate_mappings();

// we are keeping track of non-ceiling mis in the NON_CEILING_MICS array
// so we do not consider any ceiling mics in the logic to decide which mic has the
// highest average level
let NON_CEILING_MICS=[]
for (var i in MICROPHONE_CONNECTORS) {
    if ( !CEILING_MIC_CONNECTORS.includes(MICROPHONE_CONNECTORS[i]) )
    {
      NON_CEILING_MICS.push(MICROPHONE_CONNECTORS[i])
      }
}
console.log('Non-ceiling mics= ',NON_CEILING_MICS)

async function monitorOnAutoError(message) {
  let macro = module.name.split('./')[1]
  await xapi.Command.UserInterface.Message.Alert.Display({
    Title: message.Error,
    Text: message.Message,
    Duration: 30
  })
  console.error(message)
  await xapi.Command.Macros.Macro.Deactivate({ Name: macro })
  await xapi.Command.Macros.Runtime.Restart();
}
/////////////////////////////////////////////////////////////////////////////////////////
// VARIABLES
/////////////////////////////////////////////////////////////////////////////////////////

let micArrays={};
for (var i in MICROPHONE_CONNECTORS) {
    micArrays[MICROPHONE_CONNECTORS[i].toString()]=[0,0,0,0];
}

// localCallout is used to communicate with other macros such as USB Mode v3
const localCallout = new GMM.Connect.Local(module.name.replace('./', ''))


let micHandler= () => void 0;
let lastAmpHighMicID=0;

// initialize the current ceiling mic gains to the default value
// we use the spread operator create currentCeilingMicGains as a clone of  CEILING_MIC_CONNECTORS
// to make sure we have the same number of elements as the ceiling mic connectors
let currentCeilingMicGains=[...CEILING_MIC_CONNECTORS];
let fadeTrackMicGains=[...CEILING_MIC_CONNECTORS];
for (var i in currentCeilingMicGains) {
    currentCeilingMicGains[i]=0;
    fadeTrackMicGains[i]=0;
}


let usb_mode = false;


// VUmeter threshold to trigger ducking
const attack_vu_threshold = AMPMICROPHONEHIGH;

const release_vu_threshold = AMPMICROPHONELOW;

let ducking = false;
let fade_in = false;
let attack_frames = 0;
let release_frames = 0;

function OnVuMeter(event)
{
  let level=event.VuMeter;
  let event_mic=event.id[0];
  
  //console.log(`ID=${event_mic} level=${level} attack_frames=${attack_frames} release_frames=${release_frames}`)
  if (!ducking && (level > attack_vu_threshold) && (attack_frames < ATTACK_NUM_THRESHOLD)) {
    attack_frames++;
    lastAmpHighMicID=event_mic;
  } else if (!ducking && (level < attack_vu_threshold) && (event_mic==lastAmpHighMicID)) {
    attack_frames = 0;
  } else if (ducking && (level < release_vu_threshold) && (event_mic==lastAmpHighMicID) && (release_frames < RELEASE_NUM_THRESHOLD)) {
    release_frames++;
  } else if (ducking && (level > release_vu_threshold)) {
    release_frames = 0;
    lastAmpHighMicID=event_mic;
  }
  //console.log(`after eval attack_frames=${attack_frames} release_frames=${release_frames}`)


  if (!ducking && attack_frames == ATTACK_NUM_THRESHOLD) {
    //console.log('Duck!');
    attack_frames = 0;
    ducking = true;
    lastAmpHighMicID=event_mic;
    duckAllCeilingMicGains()
  }
  
  if (ducking && release_frames == RELEASE_NUM_THRESHOLD) {
    //console.log('Uncover!');
    release_frames = 0;
    ducking = false;
    fade_in = true;
    lastAmpHighMicID=0;
  }
  
  if (!ducking && fade_in) {
    fadeInAllCeilingMicGains();
  }
}



/////////////////////////////////////////////////////////////////////////////////////////
// FUNCTIONS
/////////////////////////////////////////////////////////////////////////////////////////

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


// ---------------------- INITIALIZATION

async function init() {
  console.log('init');
  await GMM.memoryInit()

// Stop any VuMeters that might have been left from a previous macro run with a different MICROPHONE_CONNECTORS constant
  // to prevent errors due to unhandled vuMeter events.
  //TODO: USB mode re-start might need to keep vuMeters on
  xapi.Command.Audio.VuMeter.StopAll({ });

  // get the current gain values for the ceiling mics
  for (i=0;i<CEILING_MIC_CONNECTORS.length;i++) {
    getCeilingMicGain(i);
  }

 // set mic gains in persistent memory if first time setup, otherwise load from that persistent memory
  await GMM.read('ceiling_Mic_Gains').then((gains) => {
    if (CEILING_MIC_CONNECTORS.toString() === gains.mic_ids.toString())
    {
        for (i=0;i<CEILING_MIC_CONNECTORS.length;i++) {
            currentCeilingMicGains[i]=gains.gain_values[i];
        }
        console.log("Init, setting levels to normal stored...");
      // restore the gain levels to the ceiling mics pre-ducking
        for(i=0; i<CEILING_MIC_CONNECTORS.length; i++) {
            setCeilingMicGain(i, currentCeilingMicGains[i]);
        }
     }
    else {
        // The CEILING_MIC_CONNECTORS no longer matches the mic_ids value of the ceiling_Mic_Gains key,
        // in persistent storage, need to re-initialize persistent storage of initial
        // gain levels for those mics
        console.log('Correcting mis-match of data in ceiling_Mic_Gains key in Memory_Storage')
        firstTimeStorageSetup();
    }

  }).catch((e) => {
        // The ceiling_Mic_Gains key has never been created , need to initialize persistent storage of initial
        // gain levels for those mics
        firstTimeStorageSetup();
  })


    // register handler for Call Successful
    xapi.Event.CallSuccessful.on(async () => {
      console.log("Call connected...");
      startDuckingAutomation();
    });

    // register handler for Call Disconnect
    xapi.Event.CallDisconnect.on(async () => {
        console.log("Call disconnect....");
        if (usb_mode!== true) {
            stopDuckingAutomation();
        }
    });

    GMM.Event.Receiver.on(event => {
          switch (event.App) { //Based on the App (Macro Name), I'll run some code
            case 'USB_Mode_Version_3': // change to checking for USB_Mode_*
              if (event.Type == 'Error') {
                console.error(event)
              } else {
                switch (event.Value) {
                  case 'EnteringWebexMode':
                    console.warn(`You are entering Default Mode`)
                    //Run code here when Default Mode starts to configure
                    break;
                  case 'WebexModeStarted':
                    console.warn(`System is in Default Mode`)
                    stopDuckingAutomation();
                    usb_mode= false;
                    break;
                  case 'enteringUSBMode':
                    console.warn(`You are entering USB Mode`)
                    //Run code here when USB Mode starts to configure
                    break;
                  case 'USBModeStarted':
                    console.warn(`System is in Default Mode`)
                    startDuckingAutomation();
                    usb_mode= true;
                    break;
                  default:
                    break;
                }
              }
              break;
            default:
              console.debug({
                Message: `Received Message from ${event.App} and was not processed`
              })
              break;
          }
        })

}

function firstTimeStorageSetup()
{
    let ceiling_Mic_Gains = { mic_ids: CEILING_MIC_CONNECTORS, gain_values: currentCeilingMicGains }
    console.warn({ Message: 'First Time Setup Initiated', Action: 'Creating initial mic gain levels persistent storage..' })
    xapi.Command.UserInterface.Message.Alert.Display({
      Title: '⚠ Setting up Ducker mode ⚠',
      Text: 'Set-up detected, running initial check<p>Please Wait until this prompt clears. Approximate Wait 25-30 seconds'
    })
    GMM.write('ceiling_Mic_Gains', ceiling_Mic_Gains).then(() => {
      console.log({ Message: 'First Time Setup Complete', Action: 'Initial mic gain levels persistent storage created.' })
    })

}

/////////////////////////////////////////////////////////////////////////////////////////
// START/STOP AUTOMATION FUNCTIONS
/////////////////////////////////////////////////////////////////////////////////////////

function startDuckingAutomation() {
  console.log('startDuckingAutomation');
   //setting overall manual mode to false
   //manual_mode = false;

  // get the current gain values for the ceiling mics and store in variables for later use
  for (i=0;i<CEILING_MIC_CONNECTORS.length;i++) {
    getCeilingMicGain(i);
  }

  micHandler=xapi.event.on('Audio Input Connectors Microphone', OnVuMeter);

  // start VuMeter monitoring
  console.log("Turning on VuMeter monitoring...")
  for (var i in AMPLIFIED_MIC_CONNECTORS) {
    xapi.command('Audio VuMeter Start', {
      ConnectorType: 'Microphone',
      ConnectorId: AMPLIFIED_MIC_CONNECTORS[i],
      IntervalMs: 100
    });
 }
}

function stopDuckingAutomation() {
         //setting overall manual mode to true
         //manual_mode = true;
         console.log("Stopping all VuMeters...");
         xapi.Command.Audio.VuMeter.StopAll({ });
         micHandler();
         micHandler= () => void 0;

         console.log("Stopping ducking automation, setting mic levels to normal...");
         restoreAllCeilingMicGains();
}


// ---------------------- ERROR HANDLING

function handleError(error) {
  console.log(error);
}

// ---------------------- CODEC MUTE EVENT

xapi.Status.Audio.Microphones.Mute.on((state) => {
  console.log(`handleMicMuteResponse: ${state}`);
//TODO: before actually turninng off vumeter when muting (within stopDuckingAutomation()) , check to see if we are in USB mode
// because if so, it might be impossible to unmute since when not in a call, vumeter turned off disactivates the mute button
  if (state == 'On') {
      stopDuckingAutomation();
      //setTimeout(setLowTriggerVars, 2000);
    }
   else if (state == 'Off') {
      startDuckingAutomation();
   }

});

// ---------------------- CEILING MIC AUDIO GAIN

function restoreAllCeilingMicGains() {
    let restoredMicGains={}
    let gmm_status={}
    console.log("Standard Mic, setting levels to normal...");
  // restore the gain levels to the ceiling mics pre-ducking
    for(i=0; i<CEILING_MIC_CONNECTORS.length; i++) {
        setCeilingMicGain(i, currentCeilingMicGains[i]);
        restoredMicGains[`micID_${CEILING_MIC_CONNECTORS[i]}`]=currentCeilingMicGains[i]
    }
    gmm_status={
    'Action': 'MICS_GAIN_ALTERED',
    'newValue': restoredMicGains
    }
    localCallout.status(gmm_status).post()
}

function fadeInAllCeilingMicGains() {
  let restoredMicGains={}
  let gmm_status={}
  console.log("fading up mic levels to normal...");
// restore the gain levels to the ceiling mics pre-ducking one step at a time
  for(i=0; i<CEILING_MIC_CONNECTORS.length; i++) {
      if (fadeTrackMicGains[i] < currentCeilingMicGains[i]) {
        fadeTrackMicGains[i] += (fadeTrackMicGains[i]+FADE_IN_STEP <= currentCeilingMicGains[i]) ? FADE_IN_STEP : 1;
      } else {
        fade_in = false;
      }
      setCeilingMicGain(i, fadeTrackMicGains[i]);

      if (!fade_in) {
        for(i=0; i<CEILING_MIC_CONNECTORS.length; i++) {
          restoredMicGains[`micID_${CEILING_MIC_CONNECTORS[i]}`]=currentCeilingMicGains[i]
        }
        gmm_status={
        'Action': 'MICS_GAIN_ALTERED',
        'newValue': restoredMicGains
        }
        localCallout.status(gmm_status).post()
        if (SHOW_DUCKING_ALERT) xapi.Command.UserInterface.Message.Alert.Clear();
      }
  }

}

function duckAllCeilingMicGains() {
    let restoredMicGains={}
    let gmm_status={}
    console.log("Amplified Mic, ducking ceiling levels....");
    // duck the ceiling mic gain levels
    for(i=0; i<CEILING_MIC_CONNECTORS.length; i++) {
        setCeilingMicGain(i, currentCeilingMicGains[i] - DUCKING_VALUE);
        fadeTrackMicGains[i]=currentCeilingMicGains[i] - DUCKING_VALUE;
        restoredMicGains[`micID_${CEILING_MIC_CONNECTORS[i]}`]=currentCeilingMicGains[i] - DUCKING_VALUE
    }
    gmm_status={
    'Action': 'MICS_GAIN_ALTERED',
    'newValue': restoredMicGains
    }
    localCallout.status(gmm_status).post()
    if (SHOW_DUCKING_ALERT) xapi.Command.UserInterface.Message.Alert.Display({
      Title: 'Ducking Active',
      Text: 'Amplified Mic detected, ducking ceiling mics....',
      Duration: 0
    });
}

//currentCeilingMicGains
function storeCeilingMicGain(index,level) {
  let lvl = level;
  if (level == 0) {
    lvl = 8;
  }
  currentCeilingMicGains[index] = lvl;
}

function getCeilingMicGain(index) {
  xapi.Config.Audio.Input.Microphone[CEILING_MIC_CONNECTORS[index]].Level
  .get()
  .then((level) => storeCeilingMicGain(index,level));
}

function setCeilingMicGain(index, level) {
  if (level >= 0)
    xapi.Config.Audio.Input.Microphone[CEILING_MIC_CONNECTORS[index]].Level.set(level);
  else
    xapi.Config.Audio.Input.Microphone[CEILING_MIC_CONNECTORS[index]].Level.set(0);
}

init();