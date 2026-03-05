@description('Name of the key vault')
param keyVaultName string

@description('Location for the key vault')
param location string = resourceGroup().location

@description('Object ID of the Function App managed identity')
param functionAppPrincipalId string

@secure()
@description('Azure DevOps Personal Access Token')
param azureDevOpsPat string

@secure()
@description('Anthropic API Key')
param anthropicApiKey string

@secure()
@description('Webhook API Key for authenticating incoming webhooks')
param webhookApiKey string = ''

@secure()
@description('Dashboard API Key for authenticating dashboard/health-check requests')
param dashboardApiKey string = ''

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAppPrincipalId, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource secretDevOpsPat 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-devops-pat'
  properties: {
    value: azureDevOpsPat
  }
}

resource secretAnthropicKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'anthropic-api-key'
  properties: {
    value: anthropicApiKey
  }
}

resource secretWebhookApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(webhookApiKey)) {
  parent: keyVault
  name: 'webhook-api-key'
  properties: {
    value: webhookApiKey
  }
}

resource secretDashboardApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(dashboardApiKey)) {
  parent: keyVault
  name: 'dashboard-api-key'
  properties: {
    value: dashboardApiKey
  }
}

output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultName string = keyVault.name
