#!/usr/bin/env node

// Simple example showing both tools
console.log('🎭 Zapier CAPI Historical Event Sender - Examples')
console.log('================================================\n')

console.log('This project includes three main tools:')
console.log('1. Data Generator (index.js) - Creates fake CSV data')
console.log(
  '2. Webhook Sender (webhook-sender.js) - Sends CSV data to webhooks'
)
console.log(
  '3. LinkedIn CAPI Sender (linkedin-capi-sender.js) - Sends data to LinkedIn Conversions API\n'
)

console.log('Usage Examples:')
console.log('')
console.log('📊 Generate CSV data:')
console.log('  npm run generate    # or node index.js')
console.log('')
console.log('📤 Send CSV to webhook:')
console.log('  npm run send        # or node webhook-sender.js')
console.log('')
console.log('🔗 Send CSV to LinkedIn CAPI:')
console.log('  npm run linkedin    # or node linkedin-capi-sender.js')
console.log('')

// Only show programmatic example if not in CI/automated environment
if (process.env.NODE_ENV !== 'test') {
  const { generateFieldData } = require('./index.js')

  console.log('🔧 Programmatic Usage Example:')
  console.log('')
  console.log('Sample generated data:')
  console.log(`  Email: ${generateFieldData('email')}`)
  console.log(
    `  Name: ${generateFieldData('firstName')} ${generateFieldData('lastName')}`
  )
  console.log(`  Company: ${generateFieldData('companyName')}`)
  console.log(`  Country: ${generateFieldData('countryCode')}`)
  console.log(`  Currency: ${generateFieldData('currencyCode')}`)
  console.log(`  Value: ${generateFieldData('conversionValue')}`)
}

console.log('')
console.log('📋 JSON Payload Format for Webhook:')
console.log(`{
  "email": "example@company.com",
  "firstName": "John",
  "lastName": "Doe",
  "title": "Software Engineer",
  "companyName": "Tech Corp",
  "countryCode": "US",
  "currencyCode": "USD",
  "conversionValue": "125.50"
}`)
