#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const readline = require('readline-sync')
const axios = require('axios')
const crypto = require('crypto')

class LinkedInCAPISender {
  constructor() {
    this.linkedinApiVersion = '202508'
    this.accessToken = ''
    this.conversionId = ''
    this.maxApiCallsPerMinute = 60 // API calls per minute (default 60)
    this.eventsPerBatch = 100 // Events per batch (default 100)
    this.useConversionTime = false // Whether to use conversionTime from CSV
    this.resetOldTimestamps = false // Whether to reset timestamps older than 90 days
    this.debugConversionTime = 0 // Counter for debug logging
    this.csvFile = ''
    this.csvData = []
    this.totalRecords = 0
    this.sentRecords = 0
    this.failedRecords = [] // Track failed records for retry
    this.successfulEvents = [] // Track successful events for file output
    this.apiStats = new Map() // Track API response codes
    this.isRunning = false
    this.startTime = 0
    this.successfulEventsFile = '' // File to store successful events
  }

  // Get LinkedIn API version from user
  getLinkedInApiVersion() {
    console.log('\n=== LinkedIn API Configuration ===')
    const defaultVersion = '202508'

    const useDefault = readline.question(
      `Use default LinkedIn API version (${defaultVersion})? (y/n): `
    )

    if (
      useDefault.toLowerCase() === 'y' ||
      useDefault.toLowerCase() === 'yes'
    ) {
      this.linkedinApiVersion = defaultVersion
    } else {
      while (true) {
        const version = readline.question(
          'Enter LinkedIn API version (YYYYMM format, e.g., 202508): '
        )

        // Validate YYYYMM format
        if (/^\d{6}$/.test(version)) {
          this.linkedinApiVersion = version
          break
        } else {
          console.log(
            '❌ Please enter a valid version in YYYYMM format (e.g., 202508)'
          )
        }
      }
    }

    console.log(`✅ LinkedIn API version set: ${this.linkedinApiVersion}`)
  }

  // Get access token from user
  getAccessToken() {
    console.log('\n=== Access Token Configuration ===')

    while (!this.accessToken) {
      const token = readline.question('Enter LinkedIn access token: ', {
        hideEchoBack: true,
      })
      if (token && token.trim().length > 0) {
        this.accessToken = token.trim()
      } else {
        console.log('❌ Access token is required')
      }
    }

    console.log('✅ Access token set successfully')
  }

  // Get conversion ID from user
  getConversionId() {
    console.log('\n=== Conversion ID Configuration ===')

    while (!this.conversionId) {
      const conversionId = readline.question('Enter conversion ID: ')
      if (conversionId && conversionId.trim().length > 0) {
        this.conversionId = conversionId.trim()
      } else {
        console.log('❌ Conversion ID is required')
      }
    }

    console.log(`✅ Conversion ID set: ${this.conversionId}`)
  }

  // Get batch configuration from user input
  getBatchConfigurationFromUser() {
    console.log('\n=== Batch Configuration ===')

    // Events per batch configuration
    const defaultEventsPerBatch = 100
    const useDefaultBatch = readline.question(
      `Use default events per batch (${defaultEventsPerBatch})? (y/n): `
    )

    if (
      useDefaultBatch.toLowerCase() === 'y' ||
      useDefaultBatch.toLowerCase() === 'yes'
    ) {
      this.eventsPerBatch = defaultEventsPerBatch
    } else {
      while (true) {
        const batchSize = readline.question('Enter events per batch (1-1000): ')
        const batchNum = parseInt(batchSize)

        if (!isNaN(batchNum) && batchNum >= 1 && batchNum <= 1000) {
          this.eventsPerBatch = batchNum
          break
        } else {
          console.log('❌ Please enter a valid number between 1 and 1000')
        }
      }
    }

    // API calls per minute configuration
    const defaultApiCallsPerMinute = 60
    const useDefaultRate = readline.question(
      `Use default API calls per minute (${defaultApiCallsPerMinute})? (y/n): `
    )

    if (
      useDefaultRate.toLowerCase() === 'y' ||
      useDefaultRate.toLowerCase() === 'yes'
    ) {
      this.maxApiCallsPerMinute = defaultApiCallsPerMinute
    } else {
      while (true) {
        const rate = readline.question(
          'Enter max API calls per minute (1-120): '
        )
        const rateNum = parseInt(rate)

        if (!isNaN(rateNum) && rateNum >= 1 && rateNum <= 120) {
          this.maxApiCallsPerMinute = rateNum
          break
        } else {
          console.log('❌ Please enter a valid number between 1 and 120')
        }
      }
    }

    console.log(`✅ Batch size set: ${this.eventsPerBatch} events per batch`)
    console.log(
      `✅ Rate limit set: ${this.maxApiCallsPerMinute} API calls per minute`
    )
    console.log(
      `📊 Theoretical throughput: ${
        this.eventsPerBatch * this.maxApiCallsPerMinute
      } events per minute`
    )
  }

  // Get batch configuration (returns current settings)
  getBatchConfiguration() {
    return {
      batchSize: this.eventsPerBatch,
      apiCallsPerMinute: this.maxApiCallsPerMinute,
    }
  }

  // Get conversionTime configuration from user
  getConversionTimeConfiguration() {
    console.log('\n=== Conversion Time Configuration ===')

    const useConversionTimeInput = readline.question(
      'Do you want to use conversionTime from CSV if available? (y/n): '
    )

    if (
      useConversionTimeInput.toLowerCase() === 'y' ||
      useConversionTimeInput.toLowerCase() === 'yes'
    ) {
      this.useConversionTime = true
      console.log(
        '✅ Will use conversionTime from CSV when available (within last 90 days)'
      )
      console.log(
        '💡 Falls back to current timestamp if conversionTime is missing or invalid'
      )
    } else {
      this.useConversionTime = false
      console.log('✅ Will use current timestamp for all conversion events')
    }
  }

  // Check if CSV has conversionTime column and ask user if they want to use it
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
        '\nDo you want to use conversionTime from CSV? (y/n): '
      )

      if (
        useConversionTimeInput.toLowerCase() === 'y' ||
        useConversionTimeInput.toLowerCase() === 'yes'
      ) {
        this.useConversionTime = true
        console.log(
          '✅ Will use conversionTime from CSV when available (within last 90 days)'
        )

        // Ask about handling old timestamps
        console.log(
          '\n💡 LinkedIn CAPI only accepts timestamps within the last 90 days'
        )
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

        console.log(
          '💡 Falls back to current timestamp if conversionTime is missing or invalid'
        )
      } else {
        this.useConversionTime = false
        console.log('✅ Will use current timestamp for all conversion events')
      }
    } else {
      console.log('\n=== Conversion Time Configuration ===')
      console.log('⚠️  No conversionTime column found in CSV file')
      console.log('✅ Will use current timestamp for all conversion events')
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
          `ConversionTime is ${daysAgo} days old (beyond 90-day LinkedIn CAPI limit)`
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

  // Hash email with SHA-256
  hashEmail(email) {
    return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex')
  }

  // Construct single LinkedIn CAPI event
  constructLinkedInEvent(record, includeUserInfo = true) {
    let conversionTimestamp = Date.now() // Default to current timestamp
    let timeSource = 'current'

    // Check if user wants to use conversionTime from CSV
    if (this.useConversionTime && record.conversionTime) {
      const csvTimestamp = parseInt(record.conversionTime)

      if (this.isValidConversionTime(csvTimestamp)) {
        conversionTimestamp = csvTimestamp
        timeSource = 'csv'
      } else if (this.resetOldTimestamps) {
        // Use current time for old timestamps when reset option is enabled
        conversionTimestamp = Date.now()
        timeSource = 'current (reset old)'

        // Log reset action for debugging (only for first few records)
        if (this.debugConversionTime < 3) {
          const daysAgo = Math.floor(
            (Date.now() - csvTimestamp) / (1000 * 60 * 60 * 24)
          )
          console.log(
            `🔄 Reset old timestamp for ${record.email}: ${new Date(
              csvTimestamp
            ).toISOString()} (${daysAgo} days ago) → current time`
          )
        }
      } else {
        // This should not happen as validation should catch this, but fallback to current time
        const daysAgo = Math.floor(
          (Date.now() - csvTimestamp) / (1000 * 60 * 60 * 24)
        )
        console.log(
          `⚠️  Invalid conversionTime for email ${record.email}: ${new Date(
            csvTimestamp
          ).toISOString()} (${daysAgo} days ago). Using current timestamp.`
        )
      }
    }

    // Log timestamp source for debugging (only for first few records to avoid spam)
    if (this.debugConversionTime < 3) {
      const timeStr = new Date(conversionTimestamp).toISOString()
      console.log(
        `🕒 Conversion time for ${record.email}: ${timeStr} (source: ${timeSource})`
      )
      this.debugConversionTime++
    }

    // Build the base event object
    const event = {
      conversion: `urn:lla:llaPartnerConversion:${this.conversionId}`,
      conversionHappenedAt: conversionTimestamp,
      user: {
        userIds: [
          {
            idType: 'SHA256_EMAIL',
            idValue: this.hashEmail(record.email || ''),
          },
        ],
      },
    }

    // Only add conversionValue if we have valid currency data
    const currencyValidation = this.validateCurrencyData(record)
    if (currencyValidation.shouldInclude) {
      event.conversionValue = {
        currencyCode: currencyValidation.currencyCode,
        amount: currencyValidation.conversionValue.toString(),
      }
    }

    // Only add userInfo if validation allows and we have user information fields
    if (includeUserInfo) {
      const userInfoFields = {
        firstName: record.firstName,
        lastName: record.lastName,
        title: record.title,
        companyName: record.companyName,
        countryCode: record.countryCode,
      }

      // Filter out empty/undefined values
      const filteredUserInfo = Object.entries(userInfoFields)
        .filter(([key, value]) => value && value.trim() !== '')
        .reduce((obj, [key, value]) => {
          obj[key] = value
          return obj
        }, {})

      // Only add userInfo if we have any user information
      if (Object.keys(filteredUserInfo).length > 0) {
        event.user.userInfo = filteredUserInfo
      }
    }

    return event
  }

  // Construct LinkedIn CAPI batch payload
  constructBatchPayload(records) {
    // Filter and validate records before creating events
    const validRecords = []
    const skippedCount = records.length

    records.forEach((record, index) => {
      const validation = this.validateEventData(
        record,
        this.sentRecords + index
      )
      if (validation.valid) {
        validRecords.push({
          record,
          includeUserInfo: validation.includeUserInfo,
        })
      }
    })

    const actualSkipped = skippedCount - validRecords.length
    if (actualSkipped > 0) {
      console.log(
        `📊 Validation Summary: ${validRecords.length} valid, ${actualSkipped} skipped records in this batch`
      )
    }

    const elements = validRecords.map(({ record, includeUserInfo }) =>
      this.constructLinkedInEvent(record, includeUserInfo)
    )

    return {
      elements: elements,
      validRecordsCount: validRecords.length,
      skippedRecordsCount: actualSkipped,
    }
  }

  // Send batch request to LinkedIn CAPI using BATCH_CREATE
  async sendBatchToLinkedIn(records, batchIndex) {
    const batchStartTime = Date.now()
    const payload = this.constructBatchPayload(records)

    // Skip sending if no valid records in batch
    if (payload.elements.length === 0) {
      console.log(
        `⚠️  Batch ${
          batchIndex + 1
        }: No valid records to send, skipping API call`
      )
      return {
        success: true,
        sentEvents: 0,
        skippedEvents: payload.skippedRecordsCount,
        totalEvents: records.length,
        responseTime: 0,
        statusCode: 'SKIPPED',
      }
    }

    // Log request details for debugging
    await this.logApiRequest(batchIndex, payload, records.length)

    // Debug: Show first event structure to verify payload format
    if (payload.elements && payload.elements.length > 0) {
      console.log(`🔍 First event structure (for debugging):`)
      console.log(JSON.stringify(payload.elements[0], null, 2))
    }

    try {
      console.log(
        `🔄 Batch ${batchIndex + 1}: Sending ${
          records.length
        } events to LinkedIn API...`
      )

      const response = await axios.post(
        'https://api.linkedin.com/rest/conversionEvents',
        payload,
        {
          headers: {
            'LinkedIn-Version': this.linkedinApiVersion,
            'X-Restli-Protocol-Version': '2.0.0',
            'X-RestLi-Method': 'BATCH_CREATE',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          timeout: 30000, // 30 second timeout for batch requests
        }
      )

      const batchDuration = Date.now() - batchStartTime

      // Log successful response
      await this.logApiResponse(batchIndex, response, batchDuration, true)

      // Process batch response - each element corresponds to an input record
      const elements = response.data.elements || []
      const successfulEvents = []
      const failedEvents = []

      elements.forEach((element, index) => {
        const originalRecord = records[index]

        if (element.status === 201) {
          // Success
          this.sentRecords++
          successfulEvents.push({
            ...originalRecord,
            batchIndex: batchIndex,
            eventIndex: index,
            responseId: element.id,
            location: element.location,
            sentAt: new Date().toISOString(),
          })
        } else {
          // Failed
          failedEvents.push({
            record: originalRecord,
            error: element.error || {
              message: 'Unknown error',
              status: element.status,
            },
            batchIndex: batchIndex,
            eventIndex: index,
          })
        }
      })

      // Store successful events for file output
      this.successfulEvents.push(...successfulEvents)

      // Store failed events for retry
      this.failedRecords.push(...failedEvents)

      // Track API response
      this.apiStats.set(
        response.status,
        (this.apiStats.get(response.status) || 0) + 1
      )

      console.log(
        `✅ Batch ${batchIndex + 1}: ${successfulEvents.length} successful, ${
          failedEvents.length
        } failed${
          payload.skippedRecordsCount > 0
            ? `, ${payload.skippedRecordsCount} skipped`
            : ''
        }, Time: ${batchDuration}ms`
      )

      if (failedEvents.length > 0) {
        console.log(`❌ Failed events will be retried in subsequent batches`)
        failedEvents.forEach((failed, idx) => {
          console.log(
            `   Event ${failed.eventIndex + 1}: ${
              failed.error.message
            } (Status: ${failed.error.status})`
          )
        })
      }

      return {
        success: true,
        batchIndex: batchIndex,
        successfulCount: successfulEvents.length,
        failedCount: failedEvents.length,
        skippedCount: payload.skippedRecordsCount,
        duration: batchDuration,
        response: response.data,
      }
    } catch (error) {
      const batchDuration = Date.now() - batchStartTime
      const statusCode = error.response?.status || 'Network Error'
      const errorMessage = error.response?.data?.message || error.message

      // Log detailed error information
      await this.logApiError(batchIndex, error, batchDuration, payload)

      console.log(
        `❌ Batch ${
          batchIndex + 1
        }: Complete batch failed - Status: ${statusCode}, Time: ${batchDuration}ms`
      )
      console.log(`   Error: ${errorMessage}`)

      // Enhanced error diagnosis
      this.diagnoseError(error, batchIndex, batchDuration)

      // All records in this batch failed - add them to failed records for retry
      records.forEach((record, index) => {
        this.failedRecords.push({
          record: record,
          error: { message: errorMessage, status: statusCode },
          batchIndex: batchIndex,
          eventIndex: index,
        })
      })

      // Track API error
      this.apiStats.set(statusCode, (this.apiStats.get(statusCode) || 0) + 1)

      return {
        success: false,
        batchIndex: batchIndex,
        successfulCount: 0,
        failedCount: payload.validRecordsCount, // Only count valid records as failed
        skippedCount: payload.skippedRecordsCount,
        duration: batchDuration,
        error: errorMessage,
      }
    }
  }

  // Display progress for batch processing
  displayProgress() {
    const totalSent = this.sentRecords
    const totalFailed = this.failedRecords.length
    const totalProcessed = totalSent + totalFailed

    const progress = ((totalProcessed / this.totalRecords) * 100).toFixed(1)
    const successRate =
      totalProcessed > 0
        ? ((totalSent / totalProcessed) * 100).toFixed(1)
        : '0.0'

    // Calculate actual sending rate
    const elapsedTime = (Date.now() - this.startTime) / 1000 / 60 // minutes
    const actualRate =
      elapsedTime > 0 ? (totalProcessed / elapsedTime).toFixed(0) : '0'

    process.stdout.write(
      `\r🚀 Progress: ${progress}% | Sent: ${totalSent}/${this.totalRecords} | Success Rate: ${successRate}% | Failed: ${totalFailed} | Rate: ${actualRate} events/min`
    )
  }

  // Simple network connectivity test
  async testBasicConnectivity() {
    console.log('\n🔍 Testing basic network connectivity...')

    // First test: Basic internet connectivity
    try {
      console.log('🌐 Step 1: Testing general internet connectivity...')
      await axios.get('https://httpbin.org/get', {
        timeout: 3000,
        headers: { 'User-Agent': 'LinkedIn-CAPI-Sender/1.0' },
      })
      console.log('   ✅ General internet connectivity: OK')
    } catch (error) {
      console.log('   ❌ General internet connectivity failed')
      console.log(`   Error: ${error.message}`)
      console.log('   💡 Check your internet connection')
      return false
    }

    // Second test: LinkedIn domain connectivity
    try {
      console.log('🔗 Step 2: Testing LinkedIn domain connectivity...')

      // Use a simple HEAD request to linkedin.com (not api.linkedin.com)
      const response = await axios.head('https://www.linkedin.com', {
        timeout: 5000,
        headers: {
          'User-Agent': 'LinkedIn-CAPI-Sender/1.0',
        },
      })

      console.log('   ✅ LinkedIn domain connectivity: OK')
      console.log(`   Status: ${response.status}`)

      // Third test: API domain connectivity
      try {
        console.log('🔌 Step 3: Testing LinkedIn API domain...')
        await axios.head('https://api.linkedin.com/rest/people', {
          timeout: 5000,
          headers: { 'User-Agent': 'LinkedIn-CAPI-Sender/1.0' },
        })
        console.log('   ✅ LinkedIn API domain connectivity: OK')
      } catch (apiError) {
        if (
          apiError.response?.status === 401 ||
          apiError.response?.status === 403
        ) {
          console.log(
            '   ✅ LinkedIn API domain reachable (authentication required, as expected)'
          )
        } else if (apiError.response?.status) {
          console.log(
            `   ✅ LinkedIn API domain reachable (HTTP ${apiError.response.status})`
          )
        } else {
          console.log('   ⚠️  LinkedIn API domain may have connectivity issues')
          console.log(`   Details: ${apiError.message}`)
        }
      }

      return true
    } catch (error) {
      console.log('   ❌ LinkedIn domain connectivity failed')
      console.log(`   Error: ${error.message}`)

      if (error.code === 'ENOTFOUND') {
        console.log('   💡 DNS resolution failed - check DNS settings')
      } else if (error.code === 'ECONNREFUSED') {
        console.log('   💡 Connection refused - possible firewall issue')
      } else if (error.code === 'ETIMEDOUT') {
        console.log('   💡 Connection timeout - slow network or firewall')
      }
      return false
    }
  }

  // Test LinkedIn API connectivity
  async testApiConnectivity() {
    console.log('\n🔍 Testing LinkedIn API connectivity...')
    const testStartTime = Date.now()

    try {
      // Create a minimal test payload with a single event
      const testPayload = {
        elements: [
          {
            conversion: `urn:lla:llaPartnerConversion:${this.conversionId}`,
            conversionHappenedAt: Date.now(),
            conversionValue: {
              currencyCode: 'USD',
              amount: '1.00',
            },
            user: {
              userIds: [
                {
                  idType: 'SHA256_EMAIL',
                  idValue: this.hashEmail('test@example.com'),
                },
              ],
              userInfo: {
                firstName: 'Test',
                lastName: 'User',
                countryCode: 'US',
              },
            },
          },
        ],
      }

      console.log('🔄 Testing with minimal payload...')
      console.log('📤 API Call Details:')
      console.log(`   • URL: https://api.linkedin.com/rest/conversionEvents`)
      console.log(`   • Method: POST`)
      console.log(`   • Headers:`)
      console.log(`     - LinkedIn-Version: ${this.linkedinApiVersion}`)
      console.log(`     - X-Restli-Protocol-Version: 2.0.0`)
      console.log(`     - X-RestLi-Method: BATCH_CREATE`)
      console.log(`     - Content-Type: application/json`)
      console.log(
        `     - Authorization: Bearer ${this.accessToken.substring(0, 20)}...`
      )
      console.log(`   • Payload: ${JSON.stringify(testPayload, null, 2)}`)

      const testResponse = await axios.post(
        'https://api.linkedin.com/rest/conversionEvents',
        testPayload,
        {
          headers: {
            'LinkedIn-Version': this.linkedinApiVersion,
            'X-Restli-Protocol-Version': '2.0.0',
            'X-RestLi-Method': 'BATCH_CREATE',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          timeout: 15000, // Increased timeout to 15 seconds
        }
      )

      const testDuration = Date.now() - testStartTime
      console.log('✅ LinkedIn API connectivity test successful!')
      console.log(`   Status: ${testResponse.status}`)
      console.log(`   Duration: ${testDuration}ms`)
      console.log(`   Response: ${JSON.stringify(testResponse.data, null, 2)}`)
      return true
    } catch (error) {
      const testDuration = Date.now() - testStartTime
      console.log('❌ LinkedIn API connectivity test failed')
      console.log(`   Duration: ${testDuration}ms`)

      // Log the specific error details before diagnosis
      console.log(`   Error Type: ${error.constructor.name}`)
      console.log(`   Error Code: ${error.code || 'No code'}`)
      console.log(`   Error Message: ${error.message}`)
      if (error.response) {
        console.log(`   HTTP Status: ${error.response.status}`)
        console.log(`   HTTP Status Text: ${error.response.statusText}`)
      }

      this.diagnoseError(error, 'connectivity-test', testDuration)
      return false
    }
  }

  // Send all records using LinkedIn BATCH_CREATE API
  async sendAllRecords() {
    console.log('\n=== Sending Records to LinkedIn CAPI (BATCH_CREATE) ===')

    const { batchSize, apiCallsPerMinute } = this.getBatchConfiguration()

    console.log(`📊 Batch Configuration:`)
    console.log(`   • Total records: ${this.totalRecords}`)
    console.log(`   • Events per batch: ${batchSize}`)
    console.log(`   • API calls per minute: ${apiCallsPerMinute}`)
    console.log(
      `   • Estimated batches: ${Math.ceil(this.totalRecords / batchSize)}`
    )
    console.log(
      `   • Estimated time: ${Math.ceil(
        this.totalRecords / batchSize / apiCallsPerMinute
      )} minutes`
    )

    const confirm = readline.question('\nProceed with sending? (y/n): ')
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled')
      return
    }

    this.isRunning = true
    this.startTime = Date.now()

    console.log('\n📤 Starting to send batches to LinkedIn...\n')

    // Send records in batches
    await this.sendRecordsBatch()

    const endTime = Date.now()
    const totalTime = ((endTime - this.startTime) / 1000 / 60).toFixed(2)
    const finalEventRate = (
      (this.sentRecords + this.failedRecords.length) /
      totalTime
    ).toFixed(0)

    console.log('\n\n=== Sending Complete ===')
    console.log(`✅ Successfully sent: ${this.sentRecords} events`)
    console.log(`❌ Failed to send: ${this.failedRecords.length} events`)
    console.log(`⏱️  Total time: ${totalTime} minutes`)
    console.log(`🚀 Average rate: ${finalEventRate} events per minute`)
    console.log(
      `📈 Success rate: ${(
        (this.sentRecords / this.totalRecords) *
        100
      ).toFixed(1)}%`
    )

    this.displayApiStats()

    // Save successful events to file
    if (this.successfulEvents.length > 0) {
      await this.saveSuccessfulEventsToFile()
    }

    // Display retry recommendations for failed events
    if (this.failedRecords.length > 0) {
      this.displayFailedEventsSummary()
    }
  }

  // Send records using LinkedIn BATCH_CREATE API
  async sendRecordsBatch() {
    const { batchSize, apiCallsPerMinute } = this.getBatchConfiguration()
    const targetIntervalMs = (60 * 1000) / apiCallsPerMinute // Time between API calls

    console.log(`📊 Batch Processing Configuration:`)
    console.log(`   • Events per batch: ${batchSize}`)
    console.log(`   • API calls per minute: ${apiCallsPerMinute}`)
    console.log(
      `   • Target interval: ${targetIntervalMs.toFixed(1)}ms between batches`
    )
    console.log(`   • Strategy: LinkedIn BATCH_CREATE with retry logic`)
    console.log('')

    let batchIndex = 0
    let recordsToProcess = [...this.csvData] // Copy original data
    const startTime = Date.now()

    // Process initial batches
    while (recordsToProcess.length > 0 && this.isRunning) {
      const batchStartTime = Date.now()

      // Take the next batch of records
      const currentBatch = recordsToProcess.splice(0, batchSize)

      console.log(
        `📦 Batch ${batchIndex + 1}: Processing ${
          currentBatch.length
        } records (${recordsToProcess.length} remaining)`
      )

      // Send the batch
      const result = await this.sendBatchToLinkedIn(currentBatch, batchIndex)

      // Update progress after each batch
      this.displayProgress()

      batchIndex++

      // Rate limiting - wait between API calls if needed
      if (recordsToProcess.length > 0 || this.failedRecords.length > 0) {
        const batchDuration = Date.now() - batchStartTime
        const timeToWait = Math.max(0, targetIntervalMs - batchDuration)

        if (timeToWait > 0) {
          console.log(
            `⏸️  Waiting ${timeToWait.toFixed(0)}ms to maintain rate limit...`
          )
          await this.sleep(timeToWait)
        } else {
          console.log(
            `🚀 No wait needed - batch took ${batchDuration}ms (target: ${targetIntervalMs.toFixed(
              0
            )}ms)`
          )
        }
        console.log('')
      }
    }

    // Retry failed records if any exist
    if (this.failedRecords.length > 0) {
      console.log(`\n🔄 Retrying ${this.failedRecords.length} failed events...`)

      // Extract just the record data for retry
      const recordsToRetry = this.failedRecords.map((failed) => failed.record)
      this.failedRecords = [] // Clear failed records for retry attempt

      let retryBatchIndex = 0

      while (recordsToRetry.length > 0 && this.isRunning) {
        const batchStartTime = Date.now()

        // Take the next batch of failed records
        const retryBatch = recordsToRetry.splice(0, batchSize)

        console.log(
          `🔁 Retry Batch ${retryBatchIndex + 1}: Processing ${
            retryBatch.length
          } failed records (${recordsToRetry.length} remaining)`
        )

        // Send the retry batch
        const result = await this.sendBatchToLinkedIn(
          retryBatch,
          `retry-${retryBatchIndex}`
        )

        // Update progress after each retry batch
        this.displayProgress()

        retryBatchIndex++

        // Rate limiting for retries
        if (recordsToRetry.length > 0) {
          const batchDuration = Date.now() - batchStartTime
          const timeToWait = Math.max(0, targetIntervalMs - batchDuration)

          if (timeToWait > 0) {
            console.log(
              `⏸️  Waiting ${timeToWait.toFixed(
                0
              )}ms before next retry batch...`
            )
            await this.sleep(timeToWait)
          }
          console.log('')
        }
      }
    }
  }

  // Log API request details for debugging
  async logApiRequest(batchIndex, payload, recordCount) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      batchIndex: batchIndex + 1,
      recordCount,
      requestHeaders: {
        'LinkedIn-Version': this.linkedinApiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'X-RestLi-Method': 'BATCH_CREATE',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken.substring(0, 10)}...`, // Only log first 10 chars for security
      },
      payloadSample: {
        elementsCount: payload.elements.length,
        firstElement: payload.elements[0], // Log first element as sample
      },
    }

    await this.writeLogToFile('api-requests.log', logEntry)
  }

  // Log API response details
  async logApiResponse(batchIndex, response, duration, isSuccess) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      batchIndex: batchIndex + 1,
      success: isSuccess,
      duration,
      status: response.status,
      statusText: response.statusText,
      responseData: response.data,
    }

    await this.writeLogToFile('api-responses.log', logEntry)
  }

  // Log detailed API error information
  async logApiError(batchIndex, error, duration, payload) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      batchIndex: batchIndex + 1,
      duration,
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorCode: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestConfig: {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout,
        headers: error.config?.headers,
      },
      payloadSize: JSON.stringify(payload).length,
      networkInfo: {
        syscall: error.syscall,
        errno: error.errno,
        hostname: error.hostname,
        port: error.port,
      },
    }

    await this.writeLogToFile('api-errors.log', logEntry)
  }

  // Enhanced error diagnosis
  diagnoseError(error, batchIndex, duration) {
    console.log(`\n🔍 Error Diagnosis for Batch ${batchIndex + 1}:`)

    if (error.code === 'ENOTFOUND') {
      console.log(`   ❌ DNS Resolution Failed`)
      console.log(
        `   💡 Possible causes: Network connectivity, DNS issues, incorrect API URL`
      )
      console.log(
        `   🔧 Suggestions: Check internet connection, verify LinkedIn API endpoint`
      )
    } else if (error.code === 'ECONNRESET') {
      console.log(`   ❌ Connection Reset by LinkedIn Server`)
      console.log(
        `   💡 Possible causes: Server overload, rate limiting, network issues`
      )
      console.log(
        `   🔧 Suggestions: Reduce batch size, increase delays between requests`
      )
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`   ❌ Connection Refused`)
      console.log(`   💡 Possible causes: LinkedIn API down, firewall blocking`)
      console.log(
        `   🔧 Suggestions: Check LinkedIn API status, verify network settings`
      )
    } else if (
      error.code === 'ETIMEDOUT' ||
      error.message.includes('timeout')
    ) {
      console.log(`   ❌ Request Timeout (${duration}ms)`)
      console.log(
        `   💡 Possible causes: Slow network, LinkedIn API overload, large payload`
      )
      console.log(
        `   🔧 Suggestions: Reduce batch size, increase timeout, check network speed`
      )
    } else if (error.response?.status === 400) {
      console.log(`   ❌ Bad Request (400)`)
      console.log(
        `   💡 Possible causes: Invalid payload format, missing required fields`
      )
      console.log(
        `   🔧 Suggestions: Check payload structure, verify LinkedIn API documentation`
      )
    } else if (error.response?.status === 401) {
      console.log(`   ❌ Unauthorized (401)`)
      console.log(`   💡 Possible causes: Invalid access token, expired token`)
      console.log(
        `   🔧 Suggestions: Regenerate access token, check token permissions`
      )
    } else if (error.response?.status === 429) {
      console.log(`   ❌ Rate Limited (429)`)
      console.log(`   💡 Possible causes: Exceeded LinkedIn API rate limits`)
      console.log(
        `   🔧 Suggestions: Reduce API calls per minute, increase delays`
      )
    } else if (error.response?.status >= 500) {
      console.log(`   ❌ LinkedIn Server Error (${error.response?.status})`)
      console.log(
        `   💡 Possible causes: LinkedIn API issues, server maintenance`
      )
      console.log(`   🔧 Suggestions: Retry later, check LinkedIn API status`)
    } else {
      console.log(`   ❌ Unknown Error`)
      console.log(`   💡 Error details logged to api-errors.log`)
      console.log(`   🔧 Suggestions: Check logs for more information`)
    }

    if (error.response?.data) {
      console.log(
        `   📋 LinkedIn Response:`,
        JSON.stringify(error.response.data, null, 2)
      )
    }
  }

  // Write log entry to file
  async writeLogToFile(filename, logEntry) {
    try {
      const fs = require('fs').promises
      const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '---\n'
      await fs.appendFile(filename, logLine)
    } catch (err) {
      console.log(`⚠️  Failed to write to log file ${filename}: ${err.message}`)
    }
  }

  // Save successful events to file
  async saveSuccessfulEventsToFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `successful-events-${timestamp}.json`

    try {
      const fs = require('fs').promises
      await fs.writeFile(
        filename,
        JSON.stringify(this.successfulEvents, null, 2)
      )
      console.log(
        `💾 Successfully saved ${this.successfulEvents.length} events to ${filename}`
      )
    } catch (error) {
      console.log(`❌ Failed to save successful events: ${error.message}`)
    }
  }

  // Display failed events summary and retry recommendations
  displayFailedEventsSummary() {
    console.log('\n📋 Failed Events Summary:')

    if (this.failedRecords.length === 0) {
      console.log('🎉 No failed events!')
      return
    }

    // Group failures by error type
    const errorGroups = new Map()
    for (const failed of this.failedRecords) {
      const key = `${failed.error.status}: ${failed.error.message}`
      if (!errorGroups.has(key)) {
        errorGroups.set(key, [])
      }
      errorGroups.get(key).push(failed)
    }

    console.log(`❌ Total failed events: ${this.failedRecords.length}`)
    console.log('\n📈 Failure Breakdown:')

    for (const [errorKey, failures] of errorGroups.entries()) {
      const percentage = (
        (failures.length / this.failedRecords.length) *
        100
      ).toFixed(1)
      console.log(`  ${errorKey}: ${failures.length} events (${percentage}%)`)

      // Show sample failed events for this error type
      const sample = failures.slice(0, 3)
      for (const failed of sample) {
        console.log(
          `    • Batch ${failed.batchIndex}, Event ${failed.eventIndex + 1}`
        )
      }
      if (failures.length > 3) {
        console.log(`    • ... and ${failures.length - 3} more`)
      }
    }

    // Retry recommendations
    console.log('\n💡 Retry Recommendations:')
    if (
      errorGroups.has('429: Too Many Requests') ||
      Array.from(errorGroups.keys()).some((k) => k.includes('timeout'))
    ) {
      console.log(
        '  • Reduce maxApiCallsPerMinute setting (currently ' +
          this.maxApiCallsPerMinute +
          ')'
      )
      console.log('  • Increase delay between batches')
    }

    if (
      Array.from(errorGroups.keys()).some(
        (k) => k.includes('400') || k.includes('Bad Request')
      )
    ) {
      console.log('  • Check data format and required fields')
      console.log('  • Validate LinkedIn tracking parameters')
    }

    if (
      Array.from(errorGroups.keys()).some((k) => k.includes('Network Error'))
    ) {
      console.log('  • Check internet connection')
      console.log('  • Retry during off-peak hours')
    }
  }

  // Display API statistics for batch processing
  displayApiStats() {
    console.log('\n📊 API Response Statistics:')

    if (this.apiStats.size === 0) {
      console.log('  No API calls made')
      return
    }

    const sortedStats = Array.from(this.apiStats.entries()).sort(
      (a, b) => b[1] - a[1]
    )
    const totalApiCalls = Array.from(this.apiStats.values()).reduce(
      (sum, count) => sum + count,
      0
    )

    for (const [code, count] of sortedStats) {
      const percentage = ((count / totalApiCalls) * 100).toFixed(1)
      const statusText = this.getStatusText(code)
      console.log(
        `  ${code} ${statusText}: ${count} API calls (${percentage}%)`
      )
    }

    console.log(`\n� API Call Summary:`)
    console.log(`  • Total API calls made: ${totalApiCalls}`)
    console.log(
      `  • Total events processed: ${
        this.sentRecords + this.failedRecords.length
      }`
    )
    console.log(
      `  • Average events per API call: ${(
        (this.sentRecords + this.failedRecords.length) /
        totalApiCalls
      ).toFixed(1)}`
    )
  }

  // Get human-readable status text
  getStatusText(code) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      207: 'Multi-Status (Batch Response)',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      'Network Error': 'Network/Connection Error',
    }
    return statusTexts[code] || 'Unknown'
  }

  // Utility function to sleep
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // Main execution function
  async run() {
    try {
      console.log('🔗 LinkedIn CAPI Event Sender')
      console.log('=============================')
      console.log(
        'This tool sends CSV data to LinkedIn Conversions API with rate limiting.'
      )

      this.getLinkedInApiVersion()
      this.getAccessToken()
      this.getConversionId()

      // Optional API connectivity test
      console.log('\n🔍 Connectivity Test Options:')
      console.log('1. Basic network test (quick)')
      console.log('2. Full API test (includes authentication)')
      console.log('3. Skip tests and proceed directly')

      const testChoice = readline.question('Choose option (1/2/3): ')

      if (testChoice === '1') {
        const basicConnected = await this.testBasicConnectivity()
        if (!basicConnected) {
          console.log(
            '\n❌ Basic connectivity failed. Please check your network connection.'
          )
          return
        }
      } else if (testChoice === '2') {
        const isConnected = await this.testApiConnectivity()
        if (!isConnected) {
          console.log('\n⚠️  Full API test failed. Options:')
          console.log(
            '1. Continue anyway (the actual batch requests might work)'
          )
          console.log('2. Exit and check your network/credentials')

          const continueAnyway = readline.question(
            'Continue with batch processing? (y/n): '
          )
          if (
            continueAnyway.toLowerCase() !== 'y' &&
            continueAnyway.toLowerCase() !== 'yes'
          ) {
            console.log('\n❌ Operation cancelled. Please check:')
            console.log('• Network connectivity to api.linkedin.com')
            console.log('• LinkedIn access token validity')
            console.log('• Corporate firewall settings')
            console.log('• Conversion ID correctness')
            return
          }
        }
      } else {
        console.log(
          '⚠️  Skipping connectivity tests - proceeding directly to batch processing'
        )
      }

      this.getBatchConfigurationFromUser()
      this.selectCsvFile()
      this.parseCsvFile()
      this.getConversionTimeConfigurationIfAvailable()
      await this.sendAllRecords()

      console.log('\n🎉 Process completed!')
    } catch (error) {
      console.error('\n❌ Application error:', error.message)
      console.error('Stack trace:', error.stack)
      process.exit(1)
    }
  }
}

// Run the application if this file is executed directly
if (require.main === module) {
  const sender = new LinkedInCAPISender()
  sender.run()
}

module.exports = LinkedInCAPISender
