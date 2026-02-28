@description('Name of the Function App')
param functionAppName string

@description('Location for the Function App')
param location string = resourceGroup().location

@description('Storage account connection string')
param storageConnectionString string

@description('Key Vault URI')
param keyVaultUri string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Azure DevOps organization URL')
param azureDevOpsOrgUrl string

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      functionAppScaleLimit: 5
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConnectionString }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'AZURE_DEVOPS_ORG_URL', value: azureDevOpsOrgUrl }
        { name: 'AZURE_DEVOPS_PAT', value: '@Microsoft.KeyVault(VaultName=${keyVaultUri};SecretName=azure-devops-pat)' }
        { name: 'ANTHROPIC_API_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVaultUri};SecretName=anthropic-api-key)' }
        { name: 'TARGET_BRANCH', value: 'main' }
        { name: 'MAX_BUDGET_PER_BUG', value: '2.00' }
        { name: 'MAX_AGENT_TURNS', value: '50' }
        { name: 'AGENT_MODEL', value: 'claude-sonnet-4-6' }
      ]
    }
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output principalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
