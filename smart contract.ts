/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';

// Define the DataPoint interface
interface DataPoint {
    docType: string;
    ID: string; // Unique identifier
    Temperature: number; // Temperature value
    Alert: string; // Alert message if the temperature exceeds the threshold
    Owner: string; // Organization owner of the data point
}

const TEMPERATURE_THRESHOLD = 20; // Temperature threshold in Celsius

@Info({ title: 'EnvironmentalDataContract', description: 'Smart contract for tracking environmental data points' })
export class EnvironmentalDataContract extends Contract {

    // Helper to validate input parameters
    private validateInput(id: string, temperature?: number): void {
        if (!id || typeof id !== 'string') {
            throw new Error('Invalid ID. It must be a non-empty string.');
        }
        if (temperature !== undefined && (typeof temperature !== 'number' || temperature < -50 || temperature > 150)) {
            throw new Error('Invalid temperature. It must be a number between -50 and 150°C.');
        }
    }

    // Initialize the ledger with some default data points
    @Transaction()
    public async InitLedger(ctx: Context): Promise<void> {
        const dataPoints: DataPoint[] = [
            { docType: 'dataPoint', ID: 'data1', Temperature: 20, Alert: '', Owner: 'Org1' },
            { docType: 'dataPoint', ID: 'data2', Temperature: 25, Alert: '', Owner: 'Org1' }, // Temperature alert! Exceeds threshold.
            { docType: 'dataPoint', ID: 'data3', Temperature: 18, Alert: '', Owner: 'Org1' },
            { docType: 'dataPoint', ID: 'data4', Temperature: 22, Alert: '', Owner: 'Org1' },
            { docType: 'dataPoint', ID: 'data5', Temperature: 24, Alert: '', Owner: 'Org1' },
        ];

        for (const dataPoint of dataPoints) {
            await ctx.stub.putState(dataPoint.ID, Buffer.from(stringify(sortKeysRecursive(dataPoint))));
            console.info(`DataPoint ${dataPoint.ID} initialized with temperature ${dataPoint.Temperature}`);
        }
        console.info('Ledger initialized with default data points.');
    }

    // Add a new data point
    @Transaction()
    public async AddDataPoint(ctx: Context, id: string, temperature: number, owner: string): Promise<void> {
        this.validateInput(id, temperature);

        if (await this.DataPointExists(ctx, id)) {
            throw new Error(`The data point ${id} already exists`);
        }

        const alert = temperature > TEMPERATURE_THRESHOLD 
            ? `Temperature alert! Data point ${id} has a temperature of ${temperature}°C, exceeding the threshold of ${TEMPERATURE_THRESHOLD}°C.` 
            : '';

        const dataPoint: DataPoint = {
            docType: 'dataPoint',
            ID: id,
            Temperature: temperature,
            Alert: alert,
            Owner: owner,
        };

        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(dataPoint))));
        console.info(`Added DataPoint: ${id} with alert: ${alert}`);
    }

    // Read a data point by its ID
    @Transaction(false)
    public async ReadDataPoint(ctx: Context, id: string): Promise<string> {
        this.validateInput(id);

        const dataPointJSON = await ctx.stub.getState(id);
        if (!dataPointJSON || dataPointJSON.length === 0) {
            throw new Error(`The data point ${id} does not exist`);
        }
        console.info(`Read DataPoint: ${id}`);
        return dataPointJSON.toString();
    }

    // Update an existing data point
    @Transaction()
    public async UpdateDataPoint(ctx: Context, id: string, temperature: number): Promise<void> {
        this.validateInput(id, temperature);

        const dataPointJSON = await ctx.stub.getState(id);
        if (!dataPointJSON || dataPointJSON.length === 0) {
            throw new Error(`The data point ${id} does not exist`);
        }

        const dataPoint: DataPoint = JSON.parse(dataPointJSON.toString());

        let alert = dataPoint.Alert;
        if (temperature > TEMPERATURE_THRESHOLD && !alert) {
            alert = `Temperature alert! Data point ${id} has a temperature of ${temperature}°C, exceeding the threshold of ${TEMPERATURE_THRESHOLD}°C.`;
        }

        dataPoint.Temperature = temperature;
        dataPoint.Alert = alert;

        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(dataPoint))));
        console.info(`Updated DataPoint: ${id} with alert: ${alert}`);
    }

    // Delete a data point
    @Transaction()
    public async DeleteDataPoint(ctx: Context, id: string): Promise<void> {
        this.validateInput(id);

        if (!(await this.DataPointExists(ctx, id))) {
            throw new Error(`The data point ${id} does not exist`);
        }
        await ctx.stub.deleteState(id);
        console.info(`Deleted DataPoint: ${id}`);
    }

    // Transfer a data point to a different organization (change the owner)
    @Transaction()
    public async TransferDataPoint(ctx: Context, id: string, newOwner: string): Promise<void> {
        this.validateInput(id);

        const dataPointJSON = await ctx.stub.getState(id);
        if (!dataPointJSON || dataPointJSON.length === 0) {
            throw new Error(`The data point ${id} does not exist`);
        }

        const dataPoint: DataPoint = JSON.parse(dataPointJSON.toString());
        dataPoint.Owner = newOwner;

        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(dataPoint))));
        console.info(`Transferred DataPoint ${id} to ${newOwner}`);
    }

    // Get all data points
    @Transaction(false)
    @Returns('string')
    public async GetAllDataPoints(ctx: Context): Promise<string> {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.error(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        console.info('Retrieved all data points.');
        return JSON.stringify(allResults, null, 2);
    }

    // Helper to check if a data point exists
    @Transaction(false)
    @Returns('boolean')
    public async DataPointExists(ctx: Context, id: string): Promise<boolean> {
        const dataPointJSON = await ctx.stub.getState(id);
        return !!dataPointJSON && dataPointJSON.length > 0;
    }

    @Transaction()
    public async ConsensusOnThresholdCrossed(ctx: Context, id: string): Promise<void> {
    // Get the MSP ID of the client calling the chaincode
    const mspId = ctx.clientIdentity.getMSPID();
    if (mspId !== 'Org2MSP') {
        throw new Error('Only Org2 can perform consensus check.');
    }

    // Retrieve the state of the data point from the ledger
    const dataPointJSON = await ctx.stub.getState(id);
    if (!dataPointJSON || dataPointJSON.length === 0) {
        throw new Error(`The data point ${id} does not exist`);
    }

    // Parse the data point from JSON
    const dataPoint: DataPoint = JSON.parse(dataPointJSON.toString());

    // Log the current temperature for debugging
    console.info(`Consensus check on DataPoint ${id} with temperature ${dataPoint.Temperature}°C.`);

    // Check if the temperature exceeds the threshold
    if (dataPoint.Temperature > TEMPERATURE_THRESHOLD) {
        // Define the new alert message
        const newAlert = `Temperature alert! Data point ${id} has a temperature of ${dataPoint.Temperature}°C, exceeding the threshold of ${TEMPERATURE_THRESHOLD}°C.`;
        
        // Only update the alert if it doesn't exist or if it needs updating
        if (dataPoint.Alert !== newAlert) {
            dataPoint.Alert = newAlert;
            // Store the updated data point back to the ledger
            await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(dataPoint))));
            console.info(`Consensus on DataPoint ${id}: Alert updated to: ${newAlert}`);
        } else {
            console.info(`Consensus on DataPoint ${id}: No update needed, alert already set.`);
        }
    } else {
        console.info(`Consensus on DataPoint ${id}: Temperature is within safe range.`);
    }
}

}
