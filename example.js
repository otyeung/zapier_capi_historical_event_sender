// Example script showing how to use the fake data generator and webhook sender programmatically
const {
  generateFieldData,
  generateCSV,
  availableFields,
} = require('./index.js')
// Note: We're not running the webhook sender here, just showing how to import it
// const WebhookSender = require('./webhook-sender.js');

console.log('🎭 Example Usage: Fake Data Generator & Webhook Sender')
console.log('=====================================================\n')

// Example 1: Generate data for specific fields
console.log('=== Example 1: Generate data for specific fields ===')
const selectedFields = ['email', 'firstName', 'lastName', 'companyName']
const csvContent = generateCSV(selectedFields, 3)
console.log('Generated CSV content:')
console.log(csvContent)

console.log('\n=== Example 2: Generate individual field data ===')
console.log('Random email:', generateFieldData('email'))
console.log('Random firstName:', generateFieldData('firstName'))
console.log('Random lastName:', generateFieldData('lastName'))
console.log('Random title:', generateFieldData('title'))
console.log('Random companyName:', generateFieldData('companyName'))
console.log('Random countryCode:', generateFieldData('countryCode'))
console.log('Random currencyCode:', generateFieldData('currencyCode'))
console.log('Random conversionValue:', generateFieldData('conversionValue'))

console.log('\n=== Available Fields ===')
console.log(JSON.stringify(availableFields, null, 2))

console.log('\n=== Example 3: Webhook Sender Programmatic Usage ===')
console.log('To use the webhook sender programmatically:')
console.log(`
const WebhookSender = require('./webhook-sender.js');

async function sendData() {
  const sender = new WebhookSender();

  // Set configuration programmatically (optional)
  // sender.webhookUrl = 'https://your-webhook-url.com/endpoint';
  // sender.maxRequestsPerMinute = 30;

  // Run interactive process
  await sender.run();
}

sendData().catch(console.error);
`)

console.log('\n=== Example 4: Sample JSON Payload ===')
const sampleRecord = {
  email: generateFieldData('email'),
  firstName: generateFieldData('firstName'),
  lastName: generateFieldData('lastName'),
  title: generateFieldData('title'),
  companyName: generateFieldData('companyName'),
  countryCode: generateFieldData('countryCode'),
  currencyCode: generateFieldData('currencyCode'),
  conversionValue: generateFieldData('conversionValue'),
}

console.log('Sample JSON payload that would be sent to webhook:')
console.log(JSON.stringify(sampleRecord, null, 2))
