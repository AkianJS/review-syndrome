targetScope = 'resourceGroup'

@description('Base name for all resources')
param baseName string = 'reviewsyndrome'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Azure DevOps organization URL')
param azureDevOpsOrgUrl string

@secure()
@description('Azure DevOps Personal Access Token')
param azureDevOpsPat string

@secure()
@description('Anthropic API Key')
param anthropicApiKey string

@secure()
@description('Webhook API Key (optional — leave empty to disable webhook auth)')
param webhookApiKey string = ''

@secure()
@description('Dashboard API Key (optional — leave empty to disable dashboard auth)')
param dashboardApiKey string = ''

// Unique suffix for globally unique names
var uniqueSuffix = uniqueString(resourceGroup().id)
var storageAccountName = '${baseName}${take(uniqueSuffix, 8)}'
var functionAppName = '${baseName}-func-${take(uniqueSuffix, 6)}'
var keyVaultName = '${baseName}-kv-${take(uniqueSuffix, 6)}'
var appInsightsName = '${baseName}-insights'
var logAnalyticsName = '${baseName}-logs'

// Log Analytics Workspace (required by Application Insights)
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// Storage Account (queues + tables)
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    storageAccountName: storageAccountName
    location: location
  }
}

// Function App
module functionApp 'modules/function-app.bicep' = {
  name: 'functionApp'
  params: {
    functionAppName: functionAppName
    location: location
    storageConnectionString: storage.outputs.connectionString
    keyVaultUri: keyVaultName
    appInsightsConnectionString: appInsights.properties.ConnectionString
    azureDevOpsOrgUrl: azureDevOpsOrgUrl
    enableWebhookAuth: !empty(webhookApiKey)
    enableDashboardAuth: !empty(dashboardApiKey)
  }
}

// Key Vault (depends on Function App for managed identity)
module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault'
  params: {
    keyVaultName: keyVaultName
    location: location
    functionAppPrincipalId: functionApp.outputs.principalId
    azureDevOpsPat: azureDevOpsPat
    anthropicApiKey: anthropicApiKey
    webhookApiKey: webhookApiKey
    dashboardApiKey: dashboardApiKey
  }
}

output functionAppUrl string = 'https://${functionApp.outputs.defaultHostName}'
output webhookUrl string = 'https://${functionApp.outputs.defaultHostName}/api/webhook-handler'
output healthCheckUrl string = 'https://${functionApp.outputs.defaultHostName}/api/health-check'
output storageAccountName string = storage.outputs.storageAccountName
output keyVaultName string = keyVault.outputs.keyVaultName
