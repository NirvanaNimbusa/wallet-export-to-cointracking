var ctCsvHeader = ['Type', 'Buy', 'Cur.', 'Sell', 'Cur.', 'Fee', 'Cur.', 'Exchange', 'Group', 'Comment', 'Date', 'Trade ID'];

var ctField = {
  Type: 0,
  Buy: 1,
  BuyCurrency: 2,
  Sell: 3,
  SellCurrency: 4,
  Fee: 5,
  FeeCurrency: 6,
  Exchange: 7,
  Group: 8,
  Comment: 9,
  Date: 10,
  TxID: 11
};

var ctTransactionType = {
  Deposit: 'Deposit',
  Donation: 'Donation',
  Gift: 'Gift',
  GiftTip: 'Gift/Tip',
  Income: 'Income',
  Lost: 'Lost',
  Mining: 'Mining',
  Stolen: 'Stolen',
  Trade: 'Trade',
  Withdrawal: 'Withdrawal',
  Spend: 'Spend'
};

var fileTypeMatch = new RegExp('^.*Confirmed,Date,Type,Label,Address,Amount.*,ID.*$', 'g');

var csvDialect = {
  csvddfVersion: 1.2,
  delimiter: ',',
  doubleQuote: true,
  lineTerminator: '\r\n',
  quoteChar: '"',
  skipInitialSpace: true,
  header: true
};

var coinCode = null;
var walletName = null;
var ctGroup = null;
var isCostBasisZero = null;
var homeFiatCurrency = null;
var minDataDate = null;
var maxDataDate = null;
var file = {};

$(function() {
  $('#file').val('');
  disableConvert();
  hideDownload();
  setCoinCode('');

  let isHidden = false;
  $('.more-details').click(() => {
    $('.explain').toggle();
    isHidden = !isHidden;
    if (isHidden) {
      $('.more-details').text('hide');
    } else {
      $('.more-details').text('more details');
    }
  });

  $('#costBasisZero').change(() => {
    $('#fiatUI').toggle($('#costBasisZero').prop('checked'));
  });

  $('#file').change(function() {
    disableConvert();
    hideDownload();
    hideError();

    file = this.files[0];

    let reader = new FileReader();

    reader.onload = function(e) {
      let text = reader.result;

      let firstLine = text.split('\n').shift(); // first line

      firstLine = firstLine.replace(/\r/g, '');
      firstLine = firstLine.replace(/"/g, '');
      //console.log(firstLine);

      if (firstLine.match(fileTypeMatch)) {
        enableConvert();
        let autoDetectCoinCode = firstLine.replace(/^[^(]*\(/, '').replace(/\)[^(]*$/, '');
        setCoinCode(autoDetectCoinCode);
      } else {
        setCoinCode('');
        showError('Wrong file or wallet export format not supported');
      }
    };

    reader.readAsText(file, 'UTF-8');
  });

  $('#convert').click(function() {
    coinCode = $('#coinCode')
      .val()
      .toUpperCase();
    walletName = $('#walletName').val();
    ctGroup = $('#ctGroup').val();
    isCostBasisZero = $('#costBasisZero').prop('checked');
    homeFiatCurrency = $('#homeFiatCurrency').val();
    groupByDay = $('#groupMiningByDay').prop('checked');

    if (!validateInput()) return;

    resetDateDates();

    CSV.fetch({
      file: file
    }).done(function(dataset) {
      //consoleconsole.log(dataset);
      let csvObject = convert(dataset, groupByDay);
      //console.log(csvObject);
      let csvData = CSV.serialize(csvObject, csvDialect);

      csvData = csvData.substring(0, csvData.length - csvDialect.lineTerminator.length); //remove last line, this is a fix cointracking CSV parser bug. It may introduce a bug if they change to require last empty line

      //console.log(csvData);
      showDownload(getFileName(coinCode, walletName), csvData);
    });
  });
});

function resetDateDates() {
  minDataDate = new Date('2199-01-01'); //I won't live longer than 2085 :)
  maxDataDate = new Date('2000-01-01'); //crypto didn't exists before 2007
}

function setCoinCode(coinCode) {
  $('#coinCode').val(coinCode);
}

function convert(dataset, groupByDay) {
  let csvObject = [ctCsvHeader];
  let i;
  let map = new Map();

  for (i = 0; i < dataset.records.length; i++) {
    let row = dataset.records[i];
    if (row[0] == 'false') continue;
    let line = convertRow(row, groupByDay, map);
    if (line) {
      csvObject.push(line);
    }
  }

  if (groupByDay) {
    for (var [key, line] of map) {
      if (line[ctField.TxID] === '') {  //set id only if empty, this means 1+ rows in a day, otherwise keep original TxID since only 1 row that day
        line[ctField.TxID] = getFakeTxId(line.toString(), key);
      }
      csvObject.push(line);
    }
  }

  return csvObject;
}

function getFakeTxId(str, date) {
  var hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return 'computedID:' + hash + '-' + date;
}

function convertRow(row, groupByDay, map) {
  let ctLine = ['', '', '', '', '', '', '', '', '', '', '', ''];

  ctLine[ctField.Exchange] = walletName;
  ctLine[ctField.Date] = row[1].replace('T', ' ');
  ctLine[ctField.TxID] = row[6];
  ctLine[ctField.Group] = ctGroup;

  let date = row[1].split('T')[0];
  let amount = row[5].replace('-', '');
  let label = row[3];
  let txType = row[2];

  let rowDate = new Date(date);

  if (minDataDate > rowDate) {
    minDataDate = rowDate;
  }

  if (maxDataDate < rowDate) {
    maxDataDate = rowDate;
  }

  switch (txType.toLowerCase()) {
    case 'sent to':
      ctLine[ctField.Type] = ctTransactionType.Withdrawal;
      ctLine[ctField.Sell] = amount;
      ctLine[ctField.SellCurrency] = coinCode;
      ctLine[ctField.Fee] = '0.00000001'; //the only way to keep currency code in CT is to have some amount, so again decided to put 1 sat to make editing faster by having fee coin code ready
      ctLine[ctField.FeeCurrency] = coinCode;
      ctLine[ctField.Comment] = `You must update the fee based on deposit amount from this withdrawal! Sent to: ${label}`;
      break;
    case 'minted':
    case 'mined':
    case 'mining':
    case 'masternode reward':
      ctLine = formatMiningLineOrMap(ctLine, amount, date, groupByDay, map);
      break;
    case 'received with':
      ctLine[ctField.Type] = ctTransactionType.Deposit;
      ctLine[ctField.Buy] = amount;
      ctLine[ctField.BuyCurrency] = coinCode;
      break;
    case 'payment to yourself':
      ctLine[ctField.Type] = ctTransactionType.Spend;
      ctLine[ctField.Sell] = amount;
      ctLine[ctField.SellCurrency] = coinCode;
      ctLine[ctField.Fee] = amount;
      ctLine[ctField.FeeCurrency] = coinCode;
      ctLine[ctField.Comment] = 'Payment to yourself';
      break;
    default:
      if (txType.toLowerCase().includes('stake')) {
        ctLine = formatMiningLineOrMap(ctLine, amount, date, groupByDay, map);
      } else {
        ctLine[ctField.Type] = ctTransactionType.Trade;
        ctLine[ctField.Buy] = amount;
        ctLine[ctField.BuyCurrency] = coinCode;
        ctLine[ctField.Sell] = amount;
        ctLine[ctField.SellCurrency] = coinCode;
        ctLine[ctField.Comment] = 'Unknown type: ' + txType + ' in export file. Please revise this!';
      }
      break;
  }

  return ctLine;
}

function fpFix(n) {
  return Math.round(n * 100000000) / 100000000;
}

function formatMiningLineOrMap(ctLine, amount, date, groupByDay, map) {
  ctLine[ctField.Buy] = eval(amount);
  ctLine[ctField.BuyCurrency] = coinCode;
  ctLine[ctField.Type] = ctTransactionType.Mining;

  if (isCostBasisZero) {
    ctLine[ctField.Type] = ctTransactionType.Trade;
    ctLine[ctField.Sell] = 0;
    ctLine[ctField.SellCurrency] = homeFiatCurrency;
  }

  if (groupByDay) {
    if (map.has(date)) {
      ctLine = map.get(date);
      ctLine[ctField.Date] = date + ' 23:59:59'; //this will ovveride only if more that 1 mint a day, otherwise we keep original date for single mint
      ctLine[ctField.TxID] = ''; //reset ID to assure same hash in case of a shift in row processing
      //console.log('amount:' + amount +' eval(amount): ' + eval(amount));
      ctLine[ctField.Buy] = fpFix(ctLine[ctField.Buy] + eval(amount));
      //console.log('After sum: ' + ctLine[ctField.Buy]);
    }

    map.set(date, ctLine);
    ctLine = null;
  }

  return ctLine;
}

function getFileName(coinCode, walletName) {
  let minDate = minDataDate.toISOString().split('T')[0];
  let maxDate = maxDataDate.toISOString().split('T')[0];

  let fullName = walletName + '-' + coinCode + '-to-cointracking-' + minDate + '--' + maxDate + '.csv';
  return fullName.toLowerCase();
}

function validateInput() {
  if (coinCode.length == 0) {
    showError('Coin Code is required!');
    return false;
  }
  if (walletName.length == 0) {
    showError('Wallet Name is required!');
    return false;
  }
  if (homeFiatCurrency.length == 0 && isCostBasisZero) {
    showError('Your local currency code is required for 0 cost basis!');
    return false;
  }
  hideError();
  return true;
}

function hideDownload() {
  $('#download').hide();
  $('#downloadFileName').hide();
}

function showDownload(fileName, data) {
  $('#download').attr('href', 'data:text/csv;base64,' + btoa(data));
  $('#download').attr('download', fileName);
  $('#download').show();
  $('#downloadFileName').text(fileName);
  $('#downloadFileName').show();
}

function enableConvert() {
  $('#convert').prop('disabled', false);
}

function disableConvert() {
  $('#convert').prop('disabled', true);
}

function hideError() {
  $('#error').text('');
  $('#error').hide();
}

function showError(text) {
  $('#error').show();
  $('#error').text(text);
}

function showPage(obj) {
  $('[id^="page-"]').hide();
  $('#page-' + obj.id).show();
}
