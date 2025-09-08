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
            record[header] = values[index].trim()
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

  // Construct JSON payload for webhook - dynamically includes all CSV fields
  constructPayload(record) {
    const payload = {}

    // Dynamically add all fields from the CSV record
    for (const [key, value] of Object.entries(record)) {
      payload[key] = value || ''
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

    // Calculate delay between requests (in milliseconds)
    const delayBetweenRequests = (60 * 1000) / this.maxRequestsPerMinute

    console.log('\n📤 Starting to send records...\n')

    for (let i = 0; i < this.csvData.length; i++) {
      if (!this.isRunning) break

      const record = this.csvData[i]
      const payload = this.constructPayload(record)

      await this.sendWebhookRequest(payload, i)
      this.displayProgress()

      // Rate limiting - wait before next request
      if (i < this.csvData.length - 1) {
        await this.sleep(delayBetweenRequests)
      }
    }

    const endTime = Date.now()
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2)

    console.log('\n\n=== Sending Complete ===')
    console.log(`✅ Successfully sent: ${this.sentRecords} records`)
    console.log(`❌ Failed to send: ${this.errors.length} records`)
    console.log(`⏱️  Total time: ${totalTime} minutes`)
    console.log(
      `📈 Success rate: ${(
        (this.sentRecords / this.totalRecords) *
        100
      ).toFixed(1)}%`
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
