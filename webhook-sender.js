#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const readline = require('readline-sync')
const axios = require('axios')

class WebhookSender {
  constructor() {
    this.webhookUrl = ''
    this.maxRequestsPerMinute = 20
    this.csvFile = ''
    this.csvData = []
    this.totalRecords = 0
    this.sentRecords = 0
    this.errors = []
    this.requestQueue = []
    this.isRunning = false
    this.useConversionTime = false // Whether to use conversionTime from CSV
    this.resetOldTimestamps = false // Whether to reset timestamps older than 90 days
  }

  // Get webhook URL from user
  getWebhookUrl() {
    console.log('\n=== Webhook Configuration ===')
    const defaultUrl = 'https://hooks.zapier.com/hooks/catch/11500618/udi6m7z/'

    const useDefault = readline.question(
      `Use default webhook URL (${defaultUrl})? (y/n): `
    )

    if (
      useDefault.toLowerCase() === 'y' ||
      useDefault.toLowerCase() === 'yes'
    ) {
      this.webhookUrl = defaultUrl
    } else {
      while (!this.webhookUrl) {
        const url = readline.question('Enter webhook URL: ')
        if (this.isValidUrl(url)) {
          this.webhookUrl = url
        } else {
          console.log('❌ Please enter a valid URL')
        }
      }
    }

    console.log(`✅ Webhook URL set: ${this.webhookUrl}`)
  }

  // Get max send rate from user
  getMaxSendRate() {
    console.log('\n=== Rate Limiting Configuration ===')
    const defaultRate = 20

    const useDefault = readline.question(
      `Use default rate limit (${defaultRate} requests per minute)? (y/n): `
    )

    if (
      useDefault.toLowerCase() === 'y' ||
      useDefault.toLowerCase() === 'yes'
    ) {
      this.maxRequestsPerMinute = defaultRate
    } else {
      while (true) {
        const rate = readline.question(
          'Enter max requests per minute (20-25): '
        )
        const rateNum = parseInt(rate)

        if (!isNaN(rateNum) && rateNum >= 20 && rateNum <= 25) {
          this.maxRequestsPerMinute = rateNum
          break
        } else {
          console.log('❌ Please enter a valid number between 20 and 25')
        }
      }
    }

    console.log(
      `✅ Rate limit set: ${this.maxRequestsPerMinute} requests per minute`
    )
  }

  // Browse and select CSV file
  selectCsvFile() {
    console.log('\n=== CSV File Selection ===')

    // Get all CSV files in current directory
    const csvFiles = fs
      .readdirSync(__dirname)
      .filter((file) => file.endsWith('.csv'))
      .sort()

    if (csvFiles.length === 0) {
      throw new Error('No CSV files found in current directory')
    }

    console.log('Available CSV files:')
    csvFiles.forEach((file, index) => {
      const stats = fs.statSync(path.join(__dirname, file))
      const sizeKB = (stats.size / 1024).toFixed(2)
      console.log(`${index + 1}. ${file} (${sizeKB} KB)`)
    })

    while (true) {
      const selection = readline.question('Select a CSV file (enter number): ')
      const index = parseInt(selection) - 1

      if (index >= 0 && index < csvFiles.length) {
        this.csvFile = csvFiles[index]
        break
      } else {
        console.log('❌ Please enter a valid number')
      }
    }

    console.log(`✅ Selected CSV file: ${this.csvFile}`)
  }

  // Parse CSV file
  parseCsvFile() {
    console.log('\n=== Parsing CSV File ===')

    try {
      const csvContent = fs.readFileSync(
        path.join(__dirname, this.csvFile),
        'utf8'
      )
      const lines = csvContent.trim().split('\n')

      if (lines.length < 2) {
        throw new Error(
          'CSV file must have at least a header row and one data row'
        )
      }

      // Parse header
      const headers = lines[0].split(',').map((h) => h.trim())
      console.log(`📋 Headers found: ${headers.join(', ')}`)

      // Parse data rows
      this.csvData = []
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCsvLine(lines[i])
        if (values.length === headers.length) {
          const record = {}
          headers.forEach((header, index) => {
            let value = values[index].trim()

            // Clean SFDC-specific formatting
            value = this.cleanSfdcValue(value)

            // Convert ISO-8601 to epoch for conversionTime field
            if (
              header === 'conversionTime' &&
              value &&
              this.isIso8601Date(value)
            ) {
              value = this.convertIso8601ToEpoch(value)
            }

            record[header] = value
          })
          this.csvData.push(record)
        }
      }

      this.totalRecords = this.csvData.length
      console.log(`✅ Parsed ${this.totalRecords} records successfully`)
    } catch (error) {
      throw new Error(`Failed to parse CSV file: ${error.message}`)
    }
  }

  // Parse a CSV line handling quotes and commas
  parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++ // Skip next quote
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }

    result.push(current)
    return result
  }

  // Clean SFDC-specific value formatting
  cleanSfdcValue(value) {
    // Remove surrounding quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    // Convert "[not provided]" to empty string
    if (value === '[not provided]') {
      value = ''
    }

    // Handle escaped quotes within the value
    value = value.replace(/""/g, '"')

    return value
  }

  // Check if a string is in ISO-8601 date format
  isIso8601Date(dateString) {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
    return iso8601Regex.test(dateString)
  }

  // Convert ISO-8601 date string to epoch milliseconds
  convertIso8601ToEpoch(iso8601String) {
    try {
      const date = new Date(iso8601String)
      if (isNaN(date.getTime())) {
        console.log(`⚠️  Invalid ISO-8601 date format: ${iso8601String}`)
        return ''
      }
      return date.getTime().toString()
    } catch (error) {
      console.log(
        `⚠️  Error converting date ${iso8601String}: ${error.message}`
      )
      return ''
    }
  }

  // Check if CSV has conversionTime column and ask user configuration
  getConversionTimeConfigurationIfAvailable() {
    // Check if CSV has conversionTime column
    if (
      this.csvData.length > 0 &&
      this.csvData[0].hasOwnProperty('conversionTime')
    ) {
      console.log('\n=== Conversion Time Configuration ===')
      console.log('💡 Found conversionTime column in CSV file')

      // Show a sample of the conversionTime values
      const sampleTimes = this.csvData.slice(0, 3).map((record) => {
        if (record.conversionTime) {
          const date = new Date(parseInt(record.conversionTime))
          return `   • ${date.toISOString()}`
        }
        return '   • (empty)'
      })
      console.log('📋 Sample conversionTime values:')
      console.log(sampleTimes.join('\n'))

      const useConversionTimeInput = readline.question(
        '\nDo you want to include conversionTime from CSV in webhook payload? (y/n): '
      )

      if (
        useConversionTimeInput.toLowerCase() === 'y' ||
        useConversionTimeInput.toLowerCase() === 'yes'
      ) {
        this.useConversionTime = true

        // Ask about handling old timestamps
        console.log('\n💡 Some timestamps might be older than 90 days')
        const resetOldInput = readline.question(
          'Reset timestamps older than 90 days to current time? (y/n): '
        )

        if (
          resetOldInput.toLowerCase() === 'y' ||
          resetOldInput.toLowerCase() === 'yes'
        ) {
          this.resetOldTimestamps = true
          console.log('✅ Will reset old timestamps to current time')
        } else {
          this.resetOldTimestamps = false
          console.log('✅ Will skip events with timestamps older than 90 days')
        }

        console.log('✅ Will include conversionTime in webhook payload')
      } else {
        this.useConversionTime = false
        console.log('✅ Will exclude conversionTime from webhook payload')
      }
    } else {
      console.log('\n=== Conversion Time Configuration ===')
      console.log('⚠️  No conversionTime column found in CSV file')
      this.useConversionTime = false
    }
  }

  // Validate if timestamp is within last 90 days
  isValidConversionTime(timestamp) {
    if (!timestamp || isNaN(timestamp)) {
      return false
    }

    const now = Date.now()
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000 // 90 days in milliseconds

    return timestamp >= ninetyDaysAgo && timestamp <= now
  }

  // Validate currency code and conversion value pair
  validateCurrencyData(record) {
    const hasCurrencyCode =
      record.currencyCode && record.currencyCode.trim() !== ''
    const hasConversionValue =
      record.conversionValue && record.conversionValue.trim() !== ''

    // If neither field is provided, that's fine - both will be ignored
    if (!hasCurrencyCode && !hasConversionValue) {
      return { valid: true, shouldInclude: false }
    }

    // If only one field is provided, ignore both
    if (!hasCurrencyCode || !hasConversionValue) {
      return {
        valid: true,
        shouldInclude: false,
        warning:
          'Currency data incomplete - both currencyCode and conversionValue required, ignoring both fields',
      }
    }

    // Validate currency code format (3-character ISO code)
    const currencyCode = record.currencyCode.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      return {
        valid: true,
        shouldInclude: false,
        warning:
          'Invalid currencyCode format - must be 3-character ISO code, ignoring currency data',
      }
    }

    // Validate conversion value (must be a number >= 0)
    const conversionValue = parseFloat(record.conversionValue)
    if (isNaN(conversionValue) || conversionValue < 0) {
      return {
        valid: true,
        shouldInclude: false,
        warning:
          'Invalid conversionValue - must be a number >= 0, ignoring currency data',
      }
    }

    return { valid: true, shouldInclude: true, currencyCode, conversionValue }
  }

  // Validate user information fields
  validateUserInfo(record) {
    const userInfoFields = ['title', 'companyName', 'countryCode']
    const hasUserInfo = userInfoFields.some(
      (field) => record[field] && record[field].trim() !== ''
    )

    if (!hasUserInfo) {
      return { valid: true, includeUserInfo: false }
    }

    const hasFirstName = record.firstName && record.firstName.trim() !== ''
    const hasLastName = record.lastName && record.lastName.trim() !== ''

    if (hasFirstName && hasLastName) {
      return { valid: true, includeUserInfo: true }
    }

    // User info present but missing required firstName/lastName
    const missingFields = []
    if (!hasFirstName) missingFields.push('firstName')
    if (!hasLastName) missingFields.push('lastName')

    return {
      valid: true,
      includeUserInfo: false,
      warning: `User information detected but missing required fields (${missingFields.join(
        ', '
      )}). Excluding all user information fields (firstName, lastName, title, companyName, countryCode) from this record.`,
    }
  }

  // Validate event data before sending
  validateEventData(record, index) {
    const errors = []
    const warnings = []

    // 1. Must have email (assuming data source is CRM)
    if (!record.email || record.email.trim() === '') {
      errors.push('Missing required email field')
    }

    // 2. Validate user information
    const userInfoValidation = this.validateUserInfo(record)
    if (userInfoValidation.warning) {
      warnings.push(userInfoValidation.warning)
    }

    // 3. Check conversion time if using CSV timestamps and not resetting old ones
    if (
      this.useConversionTime &&
      !this.resetOldTimestamps &&
      record.conversionTime
    ) {
      const csvTimestamp = parseInt(record.conversionTime)
      if (!isNaN(csvTimestamp) && !this.isValidConversionTime(csvTimestamp)) {
        const daysAgo = Math.floor(
          (Date.now() - csvTimestamp) / (1000 * 60 * 60 * 24)
        )
        errors.push(
          `ConversionTime is ${daysAgo} days old (beyond 90-day limit)`
        )
      }
    }

    // 4. Validate currency data
    const currencyValidation = this.validateCurrencyData(record)
    if (currencyValidation.warning) {
      warnings.push(currencyValidation.warning)
    }

    // Show warnings but don't fail validation
    if (warnings.length > 0) {
      console.log(
        `⚠️  Record ${index + 1} (${
          record.email || 'no email'
        }) warnings: ${warnings.join(', ')}`
      )
    }

    if (errors.length > 0) {
      console.log(
        `⚠️  Skipping record ${index + 1} (${
          record.email || 'no email'
        }): ${errors.join(', ')}`
      )
      return false
    }

    return { valid: true, includeUserInfo: userInfoValidation.includeUserInfo }
  }

  // Construct JSON payload for webhook - dynamically includes all CSV fields
  constructPayload(record, includeUserInfo = true) {
    const payload = {}

    // Validate currency data and get validated values
    const currencyValidation = this.validateCurrencyData(record)

    // Define user information fields that should be conditionally included
    const userInfoFields = [
      'firstName',
      'lastName',
      'title',
      'companyName',
      'countryCode',
    ]

    // Dynamically add all fields from the CSV record, excluding empty values
    for (const [key, value] of Object.entries(record)) {
      // Skip user info fields if validation failed
      if (!includeUserInfo && userInfoFields.includes(key)) {
        continue
      }

      // Skip currency fields if validation failed - they'll be handled separately
      if (
        (key === 'currencyCode' || key === 'conversionValue') &&
        !currencyValidation.shouldInclude
      ) {
        continue
      }

      // Handle conversionTime specially if using CSV timestamps and reset option
      if (key === 'conversionTime' && this.useConversionTime && value) {
        const csvTimestamp = parseInt(value)

        if (!isNaN(csvTimestamp)) {
          if (this.isValidConversionTime(csvTimestamp)) {
            // Use original timestamp if valid
            payload[key] = value
          } else if (this.resetOldTimestamps) {
            // Use current timestamp if resetting old ones
            payload[key] = Date.now().toString()
          }
          // If not resetting and invalid, skip this field (validation should have caught this)
        }
      } else if (value && value.trim() !== '') {
        // Only include fields with actual values (not empty strings)
        payload[key] = value
      }
    }

    // Add validated currency data if available
    if (currencyValidation.shouldInclude) {
      payload.currencyCode = currencyValidation.currencyCode
      payload.conversionValue = currencyValidation.conversionValue.toString()
    }

    return payload
  }

  // Send single request to webhook
  async sendWebhookRequest(payload, recordIndex) {
    try {
      // Debug: Log the first few payloads to verify structure
      if (recordIndex < 3) {
        console.log(
          `🔍 Payload for record ${recordIndex + 1}:`,
          JSON.stringify(payload, null, 2)
        )
      }

      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      })

      this.sentRecords++
      return { success: true, response: response.status, index: recordIndex }
    } catch (error) {
      const errorInfo = {
        index: recordIndex,
        error: error.message,
        status: error.response?.status || 'Network Error',
      }
      this.errors.push(errorInfo)
      return { success: false, error: errorInfo }
    }
  }

  // Display progress
  displayProgress() {
    const progress = (
      ((this.sentRecords + this.errors.length) / this.totalRecords) *
      100
    ).toFixed(1)
    const successRate =
      this.sentRecords > 0
        ? (
            (this.sentRecords / (this.sentRecords + this.errors.length)) *
            100
          ).toFixed(1)
        : '0.0'

    process.stdout.write(
      `\r🚀 Progress: ${progress}% | Sent: ${this.sentRecords}/${this.totalRecords} | Success Rate: ${successRate}% | Errors: ${this.errors.length}`
    )
  }

  // Send all records with rate limiting
  async sendAllRecords() {
    console.log('\n=== Sending Records to Webhook ===')
    console.log(`📊 Total records to send: ${this.totalRecords}`)
    console.log(
      `⏱️  Rate limit: ${this.maxRequestsPerMinute} requests per minute`
    )
    console.log(
      `🕒 Estimated time: ${Math.ceil(
        this.totalRecords / this.maxRequestsPerMinute
      )} minutes`
    )

    const confirm = readline.question('\nProceed with sending? (y/n): ')
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled')
      return
    }

    this.isRunning = true
    const startTime = Date.now()
    let skippedRecords = 0

    // Calculate delay between requests (in milliseconds)
    const delayBetweenRequests = (60 * 1000) / this.maxRequestsPerMinute

    console.log('\n📤 Starting to send records...\n')

    for (let i = 0; i < this.csvData.length; i++) {
      if (!this.isRunning) break

      const record = this.csvData[i]

      // Validate record before sending
      const validation = this.validateEventData(record, i)
      if (!validation.valid) {
        skippedRecords++
        continue
      }

      const payload = this.constructPayload(record, validation.includeUserInfo)

      await this.sendWebhookRequest(payload, i)
      this.displayProgress()

      // Rate limiting - wait before next request
      if (i < this.csvData.length - 1) {
        await this.sleep(delayBetweenRequests)
      }
    }

    const endTime = Date.now()
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2)
    const processedRecords = this.sentRecords + this.errors.length

    console.log('\n\n=== Sending Complete ===')
    console.log(`✅ Successfully sent: ${this.sentRecords} records`)
    console.log(`❌ Failed to send: ${this.errors.length} records`)
    console.log(`⚠️  Skipped (validation): ${skippedRecords} records`)
    console.log(`⏱️  Total time: ${totalTime} minutes`)
    console.log(
      `📈 Success rate: ${
        processedRecords > 0
          ? ((this.sentRecords / processedRecords) * 100).toFixed(1)
          : '0.0'
      }%`
    )

    if (this.errors.length > 0) {
      console.log('\n📋 Error Summary:')
      this.errors.slice(0, 10).forEach((error) => {
        console.log(
          `  Record ${error.index + 1}: ${error.status} - ${error.error}`
        )
      })

      if (this.errors.length > 10) {
        console.log(`  ... and ${this.errors.length - 10} more errors`)
      }
    }
  }

  // Utility function to validate URL
  isValidUrl(string) {
    try {
      new URL(string)
      return true
    } catch (_) {
      return false
    }
  }

  // Utility function to sleep
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // Main execution function
  async run() {
    try {
      console.log('🎯 Webhook CSV Data Sender')
      console.log('==========================')
      console.log(
        'This tool sends CSV data to a webhook URL with rate limiting.'
      )

      this.getWebhookUrl()
      this.getMaxSendRate()
      this.selectCsvFile()
      this.parseCsvFile()
      this.getConversionTimeConfigurationIfAvailable()
      await this.sendAllRecords()

      console.log('\n🎉 Process completed!')
    } catch (error) {
      console.error('\n❌ Application error:', error.message)
      process.exit(1)
    }
  }
}

// Run the application if this file is executed directly
if (require.main === module) {
  const sender = new WebhookSender()
  sender.run()
}

module.exports = WebhookSender
