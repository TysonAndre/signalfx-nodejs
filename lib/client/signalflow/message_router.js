'use strict';
// Copyright (C) 2016 SignalFx, Inc. All rights reserved.

// a routed message handler deals with all messages within a particular channel scope

// it is responsible for massaging messages and flushing batches of data messages.

function getRoutedMessageHandler(params, onMessage) {
  var expectedBatchMessageCount = 0;
  var numBatchesDetermined = false;
  var messageBatchBuffer = [];
  var lastSeenDataTime = 0;

  function composeDataBatches(dataArray) {
    if (dataArray.length === 0) {
      console.error('Attempted to compose an empty data batch!');
      return null;
    }

    var errorOccurred = false;
    var basisData = dataArray[0];
    var expectedTimeStamp = basisData.logicalTimestampMs;
    dataArray.slice(1).forEach(function (batch) {
      if (batch.logicalTimestampMs !== expectedTimeStamp) {
        errorOccurred = true;
      } else {
        basisData.data = basisData.data.concat(batch.data);
      }
    });

    if (errorOccurred) {
      console.error('Bad timestamp pairs when flushing data batches!  Inconsistent data!');
      return null;
    }
    return basisData;
  }

  function flushBuffer() {
    if (numBatchesDetermined && messageBatchBuffer.length === expectedBatchMessageCount) {
      onMessage(composeDataBatches(messageBatchBuffer));
      messageBatchBuffer = [];
    }
  }

  return function messageReceived(msg) {
    if (!msg.type && msg.hasOwnProperty('error')) {
      onMessage(msg);
      return;
    }
    switch (msg.type) {
      case 'data':
        if (lastSeenDataTime && lastSeenDataTime !== msg.logicalTimestampMs) {
          // if zero time series are encountered, then no metadata arrives, but data batches arrive with differing
          // timestamp as the only evidence of a stream block
          numBatchesDetermined = true;
        }
        lastSeenDataTime = msg.logicalTimestampMs;
        if (!params.bigNumber) {
          msg.data.forEach(function (m) {
            m.value = m.value.toNumber();
          });
        }
        messageBatchBuffer.push(msg);
        if (!numBatchesDetermined) {
          expectedBatchMessageCount++;
        } else if (messageBatchBuffer.length === expectedBatchMessageCount) {
          flushBuffer();
        }
        break;
      case 'message':
        if (msg.message && msg.message.messageCode === 'JOB_RUNNING_RESOLUTION') {
          numBatchesDetermined = true;
          flushBuffer();
        }
        break;
      case 'metadata':
      case 'event':
        onMessage(msg);
        break;
      case 'control-message':
        if (msg.event === 'CHANNEL_ABORT') {
          onMessage(msg);
        }
        break;
      default:
        console.log('Unrecognized message type.');
        break;
    }
    flushBuffer();
  };
}

module.exports = getRoutedMessageHandler;