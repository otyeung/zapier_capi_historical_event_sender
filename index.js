#!/usr/bin/env node

const { faker } = require('@faker-js/faker')
const readline = require('readline-sync')
const fs = require('fs')
const path = require('path')

// Available data fields
const availableFields = {
  email: {
    name: 'email',
    description: 'Email address (mandatory)',
    mandatory: true,
  },
  firstName: { name: 'firstName', description: 'First name', mandatory: false },
  lastName: { name: 'lastName', description: 'Last name', mandatory: false },
  title: { name: 'title', description: 'Job title', mandatory: false },
  companyName: {
    name: 'companyName',
    description: 'Company name',
    mandatory: false,
  },
  countryCode: {
    name: 'countryCode',
    description: 'Country code (e.g., US, UK)',
    mandatory: false,
  },
  currencyCode: {
    name: 'currencyCode',
    description: 'Currency code (e.g., USD, EUR)',
    mandatory: false,
  },
  conversionValue: {
    name: 'conversionValue',
    description: 'Conversion value (numeric)',
    mandatory: false,
  },
  conversionTime: {
    name: 'conversionTime',
    description: 'Conversion time (epoch milliseconds, last 90 days)',
    mandatory: false,
  },
}

// Function to display field selection menu
function selectFields() {
  console.log('\n=== Data Field Selection ===')
  console.log('Available fields (email is mandatory):')

  const fieldKeys = Object.keys(availableFields)
  fieldKeys.forEach((key, index) => {
    const field = availableFields[key]
    const status = field.mandatory ? '[MANDATORY]' : '[OPTIONAL]'
    console.log(`${index + 1}. ${field.name} - ${field.description} ${status}`)
  })

  console.log('\nBy default, all fields are selected.')
  const useDefault = readline.question(
    'Use default selection (all fields)? (y/n): '
  )

  if (useDefault.toLowerCase() === 'y' || useDefault.toLowerCase() === 'yes') {
    return fieldKeys
  }

  console.log(
    '\nSelect fields to include (enter numbers separated by commas, e.g., 1,2,3):'
  )
  const selection = readline.question('Your selection: ')

  const selectedIndices = selection
    .split(',')
    .map((s) => parseInt(s.trim()) - 1)
  const selectedFields = selectedIndices
    .filter((index) => index >= 0 && index < fieldKeys.length)
    .map((index) => fieldKeys[index])

  // Ensure email is always included
  if (!selectedFields.includes('email')) {
    selectedFields.unshift('email')
    console.log(
      'Note: Email field is mandatory and has been automatically included.'
    )
  }

  return selectedFields
}

// Function to generate fake data based on field type
function generateFieldData(fieldName) {
  switch (fieldName) {
    case 'email':
      return faker.internet.email()
    case 'firstName':
      return faker.person.firstName()
    case 'lastName':
      return faker.person.lastName()
    case 'title':
      return faker.person.jobTitle()
    case 'companyName':
      return faker.company.name()
    case 'countryCode':
      return faker.location.countryCode()
    case 'currencyCode':
      return faker.finance.currencyCode()
    case 'conversionValue':
      return faker.number.float({ min: 1, max: 1000, fractionDigits: 2 })
    case 'conversionTime':
      // Generate random epoch time in milliseconds within last 90 days
      const now = Date.now()
      const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000 // 90 days in milliseconds
      return faker.number.int({ min: ninetyDaysAgo, max: now })
    default:
      return ''
  }
}

// Function to generate CSV content
function generateCSV(selectedFields, recordCount) {
  console.log(
    `\nGenerating ${recordCount} records with fields: ${selectedFields.join(
      ', '
    )}`
  )

  // Create header row
  const csvLines = [selectedFields.join(',')]

  // Generate data rows
  for (let i = 0; i < recordCount; i++) {
    const row = selectedFields.map((field) => {
      const value = generateFieldData(field)
      // Escape commas and quotes in CSV
      if (
        typeof value === 'string' &&
        (value.includes(',') || value.includes('"'))
      ) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    })
    csvLines.push(row.join(','))

    // Show progress for large datasets
    if (recordCount > 100 && (i + 1) % 100 === 0) {
      console.log(`Generated ${i + 1}/${recordCount} records...`)
    }
  }

  return csvLines.join('\n')
}

// Function to save CSV to file
function saveCSV(csvContent) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const filename = `fake-data-${timestamp}.csv`
  const filepath = path.join(__dirname, filename)

  try {
    fs.writeFileSync(filepath, csvContent, 'utf8')
    console.log(`\n✅ CSV file saved successfully: ${filename}`)
    console.log(`📁 Full path: ${filepath}`)
    console.log(`📊 File size: ${(csvContent.length / 1024).toFixed(2)} KB`)
    return filename
  } catch (error) {
    console.error('❌ Error saving CSV file:', error.message)
    throw error
  }
}

// Main application function
function main() {
  console.log('🎭 Fake Data Generator')
  console.log('======================')
  console.log('This tool generates fake CSV data using various data fields.')

  try {
    // Step 1: Select fields
    const selectedFields = selectFields()
    console.log(`\nSelected fields: ${selectedFields.join(', ')}`)

    // Step 2: Get number of records
    console.log('\n=== Record Count ===')
    let recordCount
    while (true) {
      const input = readline.question(
        'How many records to generate? (1-1000000): '
      )
      recordCount = parseInt(input)

      if (isNaN(recordCount) || recordCount < 1 || recordCount > 1000000) {
        console.log('❌ Please enter a valid number between 1 and 1000000.')
        continue
      }
      break
    }

    // Step 3: Generate CSV
    const csvContent = generateCSV(selectedFields, recordCount)

    // Step 4: Save to file
    const filename = saveCSV(csvContent)

    console.log('\n🎉 Generation completed successfully!')
    console.log(`\nTo view the generated data, you can:`)
    console.log(`- Open ${filename} in Excel or any spreadsheet application`)
    console.log(
      `- Use 'head -10 ${filename}' to preview first 10 lines in terminal`
    )
    console.log(`- Use 'wc -l ${filename}' to count total lines`)
  } catch (error) {
    console.error('\n❌ Application error:', error.message)
    process.exit(1)
  }
}

// Run the application if this file is executed directly
if (require.main === module) {
  main()
}

module.exports = { generateFieldData, generateCSV, availableFields }
