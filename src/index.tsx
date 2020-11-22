/******************************************************************************
 *
 * Copyright (c) 2017, the Perspective Authors.
 *
 * This file is part of the Perspective library, distributed under the terms of
 * the Apache License 2.0.  The full license can be found in the LICENSE file.
 *
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useEffect, useState, useRef } from 'react'
import perspective from '@finos/perspective'
import '@finos/perspective-viewer'
import '@finos/perspective-viewer-datagrid'
import '@finos/perspective-viewer-d3fc'
import './index.css'
import '@finos/perspective-viewer/dist/umd/material.css'
import {
  HTMLPerspectiveViewerElement,
  PerspectiveViewerOptions
} from '@finos/perspective-viewer'
import { subMinutes } from 'date-fns'
import { mainnet } from '@filecoin-shipyard/lotus-client-schema'
import { BrowserProvider } from '@filecoin-shipyard/lotus-client-provider-browser'
import {
  LotusRPC,
  MinerInfo,
  StorageAsk
} from '@filecoin-shipyard/lotus-client-rpc'
import delay from 'delay'
import PQueue from 'p-queue'
import { set as setIdb, get as getIdb } from 'idb-keyval'

const cacheMinutes = 30

const worker = perspective.shared_worker()

interface MinerRecord {
  minerNum: number
  miner: string
  askTime?: Date
  price?: number
  verifiedPrice?: number
  codefiPriceRaw?: number
  codefiPriceValue?: number
  codefiPriceUsd?: number
  codefiScore?: number
  annotationState?: string
  annotationExtra?: string
  stored?: boolean
  retrieved?: boolean
  minPieceSize?: number
  maxPieceSize?: number
  codefiMinPieceSize?: number
  codefiMaxPieceSize?: number
  codefiAskId?: string
  qualityAdjPower?: number
  rawBytePower?: number
  balance?: number
  activeSectors?: number
  faultySectors?: number
  liveSectors?: number
}

interface AskCache {
  askTime: Date
  price: number
  verifiedPrice: number
  minPieceSize: number
  maxPieceSize: number
}

interface PowerCache {
  cacheTime: Date
  qualityAdjPower: number
  rawBytePower: number
  balance: number
  activeSectors: number
  faultySectors: number
  liveSectors: number
}

const schema = {
  minerNum: 'integer',
  miner: 'string',
  askTime: 'datetime',
  price: 'float',
  verifiedPrice: 'float',
  codefiPriceRaw: 'float',
  codefiPriceValue: 'float',
  codefiPriceUsd: 'float',
  codefiScore: 'float',
  annotationState: 'string',
  annotationExtra: 'string',
  stored: 'boolean',
  retrieved: 'boolean',
  minPieceSize: 'float',
  maxPieceSize: 'float',
  codefiMinPieceSize: 'float',
  codefiMaxPieceSize: 'float',
  codefiAskId: 'string',
  qualityAdjPower: 'float',
  rawBytePower: 'float',
  balance: 'float',
  activeSectors: 'integer',
  faultySectors: 'integer',
  liveSectors: 'integer'
}

const getData = async (): Promise<MinerRecord[]> => {
  const annotationsUrl =
    'https://raw.githubusercontent.com/jimpick/workshop-client-testnet/spacerace/src/annotations-spacerace-slingshot-medium.json'
  const annotationsResp = await fetch(annotationsUrl)
  const annotations = await annotationsResp.json()

  const retrievalsUrl =
    'https://raw.githubusercontent.com/jimpick/filecoin-wiki-test/master/wiki-small-blocks-combined-128/retrievals/retrieval-success-miners.json'
  const retrievalsResp = await fetch(retrievalsUrl)
  const retrievals = new Set(await retrievalsResp.json())

  let asks = []
  try {
    const asksUrl =
      'https://api.storage.codefi.network/asks?limit=1000&offset=0'
    const asksResp = await fetch(asksUrl)
    asks = await asksResp.json()
  } catch (e) {
    console.log('Error retrieving asks:', e)
  }

  const miners = new Set([
    ...Object.keys(annotations),
    ...retrievals,
    ...asks.map(({ miner: { address } }) => address)
  ])
  const sortedMiners = [...miners].sort((a, b) => {
    return Number(a.slice(1)) - Number(b.slice(1))
  })

  const askIndex = {}
  for (const ask of asks) {
    const {
      miner: { address }
    } = ask
    askIndex[address] = ask
  }
  const data = sortedMiners.map(minerAddress => {
    const ask = askIndex[minerAddress] || {
      miner: {},
      price: { prices: {} },
      minPieceSize: {},
      maxPieceSize: {}
    }
    const {
      id: codefiAskId,
      miner: { score: codefiScore },
      price: {
        raw: codefiPriceRaw,
        value: codefiPriceValue,
        prices: { usd: codefiPriceUsd }
      },
      minPieceSize: { raw: codefiMinPieceSize },
      maxPieceSize: { raw: codefiMaxPieceSize }
    } = ask
    const annotation = annotations[minerAddress]
    const match = annotation && annotation.match(/^([^,]*), (.*)/)
    const annotationState = match ? match[1] : ''
    const annotationExtra = match ? match[2] : ''
    return {
      minerNum: Number(minerAddress.slice(1)),
      miner: minerAddress,
      askTime: null,
      price: codefiPriceRaw || 999999999999999,
      verifiedPrice: null,
      codefiPriceRaw,
      codefiPriceValue,
      codefiPriceUsd,
      codefiScore,
      annotationState,
      annotationExtra,
      stored:
        annotationState === 'active' ||
        annotationState === 'active-sealing' ||
        annotationState === 'sealing',
      retrieved: retrievals.has(minerAddress),
      minPieceSize: codefiMinPieceSize,
      maxPieceSize: codefiMaxPieceSize,
      codefiMinPieceSize,
      codefiMaxPieceSize,
      codefiAskId,
      qualityAdjPower: 0.001
    }
  })
  return data
}

const config: PerspectiveViewerOptions = {
  columns: [
    'minerNum',
    'miner',
    'annotationExtra',
    'askTime',
    'price',
    'verifiedPrice',
    'qualityAdjPower',
    'balance',
    'faultySectors',
    'liveSectors',
    // 'codefiPriceRaw',
    'codefiScore',
    'annotationState',
    'stored',
    'retrieved',
    'minPieceSize',
    'maxPieceSize'
  ],
  // 'row-pivots': ['State']
  filters: [
    ['retrieved', '==', 'true'],
    ['stored', '==', 'true'],
    ['qualityAdjPower', '>', 0 as any]
  ],
  sort: [
    ['price', 'asc'],
    ['minerNum', 'asc']
  ],
  selectable: true
}

const App = (): React.ReactElement => {
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedMiner, setSelectedMiner] = useState<string | undefined>()
  const [codefiAskId, setCodefiAskId] = useState<string | undefined>()
  const [csv, setCsv] = useState<string | undefined>()
  const [json, setJson] = useState<string | undefined>()
  const viewer = useRef<HTMLPerspectiveViewerElement>(null)

  useEffect(() => {
    if (document.location.hash !== '') {
      document.location.href = document.location.pathname
    }
    async function run () {
      const data = await getData()
      const table = worker.table(schema, { index: 'miner' })
      viewer.current.load(table)
      viewer.current.restore(config)
      viewer.current.addEventListener('perspective-select', async () => {
        const selected = document.querySelectorAll('.psp-row-selected')
        if (selected && selected[1]) {
          // FIXME: Doesn't work if rows are customized
          const selectedMiner = selected[1].textContent
          setSelectedMiner(selectedMiner)
          const view = table.view({
            columns: ['codefiAskId'],
            filter: [['miner', '==', selectedMiner]]
          })
          const data = await view.to_json()
          if (data && data[0]) {
            setCodefiAskId(data[0]['codefiAskId'])
          }
        }
      })
      window.onhashchange = async function () {
        const viewerEl = viewer.current as any
        const csv = await viewerEl.view.to_csv()
        const json = await viewerEl.view.to_json()
        setCsv(csv)
        setJson(json)
      }
      for (const row of data) {
        const columnData = {}
        for (const key in row) {
          columnData[key] = [row[key]]
        }
        table.update(columnData)
      }
      setLoading(false)
      // let baseTime = new Date()
      const endpointUrl = 'wss://lotus.jimpick.com/spacerace_api/0/node/rpc/v0'
      const provider = new BrowserProvider(endpointUrl)
      const client = new LotusRPC(provider, { schema: mainnet.fullNode })

      const oldestCacheTime = subMinutes(new Date(), cacheMinutes)
      for (const { miner } of data) {
        const ask: AskCache = await getIdb(`ask/${miner}`)
        if (ask) {
          if (ask.askTime > oldestCacheTime) {
            table.update({
              miner: [miner],
              askTime: [ask.askTime],
              price: [ask.price],
              verifiedPrice: [ask.verifiedPrice],
              minPieceSize: [ask.minPieceSize],
              maxPieceSize: [ask.maxPieceSize]
            } as any)
          }
        }
        const power: PowerCache = await getIdb(`power/${miner}`)
        if (power) {
          if (power.cacheTime > oldestCacheTime) {
            table.update({
              miner: [miner],
              qualityAdjPower: [power.qualityAdjPower],
              rawBytePower: [power.rawBytePower],
              balance: [power.balance],
              activeSectors: [power.activeSectors],
              faultySectors: [power.faultySectors],
              liveSectors: [power.liveSectors]
            } as any)
          }
        }
      }

      const powerQueue = new PQueue({ concurrency: 5 })
      for (const { miner } of data) {
        powerQueue.add(async () => {
          const minerPower = await client.stateMinerPower(miner, [])
          const {
            MinerPower: {
              QualityAdjPower: qualityAdjPower,
              RawBytePower: rawBytePower
            }
          } = minerPower
          const actor = await client.stateGetActor(miner, [])
          const { Balance: balance } = actor
          const roundedBalance = Math.round(Number(balance) / Math.pow(10, 18))
          const sectorCount = await client.stateMinerSectorCount(miner, [])
          const {
            Active: activeSectors,
            Faulty: faultySectors,
            Live: liveSectors
          } = sectorCount
          table.update({
            miner: [miner],
            qualityAdjPower: [qualityAdjPower],
            rawBytePower: [rawBytePower],
            balance: [roundedBalance],
            activeSectors: [activeSectors],
            faultySectors: [faultySectors],
            liveSectors: [liveSectors]
          } as any)
          const powerCache: PowerCache = {
            cacheTime: new Date(),
            qualityAdjPower: Number(qualityAdjPower),
            rawBytePower: Number(rawBytePower),
            balance: roundedBalance,
            activeSectors,
            faultySectors,
            liveSectors
          }
          setIdb(`power/${miner}`, powerCache)
        })
      }

      const askQueue = new PQueue({ concurrency: 5 })
      const inflight = new Set()

      while (true) {
        if (askQueue.size > 0) {
          // Busy, sleep
          // console.log('Jobs waiting, sleeping', askQueue.size)
          await delay(1000)
          continue
        }
        const viewNull = table.view({
          columns: ['miner', 'askTime'],
          filter: [['askTime', 'is null', '']],
          sort: [
            ['stored', 'desc'],
            ['retrieved', 'desc'],
            ['minerNum', 'asc']
          ]
        })
        const dataAskNullCandidates = (await viewNull.to_json()) as MinerRecord[]
        // console.log('dataAskNullCandidates', dataAskNullCandidates.length)
        const viewStale = table.view({
          columns: ['miner', 'askTime'],
          filter: [
            ['askTime', '<', subMinutes(new Date(), cacheMinutes).toISOString()]
          ],
          sort: [
            ['stored', 'desc'],
            ['retrieved', 'desc'],
            ['minerNum', 'asc']
          ]
        })
        const dataAskStaleCandidates = (await viewStale.to_json()) as MinerRecord[]
        // console.log('dataAskStaleCandidates', dataAskStaleCandidates.length)
        console.log(
          `Candidates: ${dataAskNullCandidates.length} null, ` +
            `${dataAskStaleCandidates.length} stale`
        )
        const dataAskCandidates = [
          ...dataAskNullCandidates,
          ...dataAskStaleCandidates
        ]
        if (dataAskCandidates.length > 0) {
          dataAskCandidates.length = 5 // Limit number of new tasks
          askQueue.add(async () => {
            for (const { miner } of dataAskCandidates) {
              if (!inflight.has(miner)) {
                inflight.add(miner)
                // console.log('inflight', inflight)
                for (let i in data) {
                  const record = data[i]
                  if (record.miner === miner) {
                    // console.log('updating', miner)
                    let price: number = 999999999999999
                    let verifiedPrice: number = null
                    let minPieceSize: number = null
                    let maxPieceSize: number = null
                    let state = { done: false }
                    try {
                      const timeoutFunc = async () => {
                        state.done = false
                        await delay(10 * 1000)
                        if (!state.done) {
                          throw new Error('timeout')
                        }
                      }
                      const { PeerId: peerId } = (await Promise.race([
                        client.stateMinerInfo(miner, []),
                        timeoutFunc()
                      ])) as MinerInfo
                      const ask = (await Promise.race([
                        client.clientQueryAsk(peerId, miner),
                        timeoutFunc()
                      ])) as StorageAsk
                      // console.log('Ask:', miner, ask)
                      price = Number(ask.Price)
                      verifiedPrice = Number(ask.VerifiedPrice)
                      minPieceSize = Number(ask.MinPieceSize)
                      maxPieceSize = Number(ask.MaxPieceSize)
                      state.done = true
                    } catch (e) {
                      // console.error('Error during ask', miner, e)
                    }
                    const askTime = new Date()
                    table.update({
                      miner: [miner],
                      askTime: [askTime],
                      price: [price],
                      verifiedPrice: [verifiedPrice],
                      minPieceSize: [minPieceSize],
                      maxPieceSize: [maxPieceSize]
                    } as any)
                    const askCache: AskCache = {
                      askTime,
                      price,
                      verifiedPrice,
                      minPieceSize,
                      maxPieceSize
                    }
                    setIdb(`ask/${miner}`, askCache)
                    inflight.delete(miner)
                  }
                }
              }
              continue
            }
          })
        }
        await delay(500)
      }
    }
    run()
  }, [])

  if (document.location.hash === '#csv') {
    return <pre>{csv}</pre>
  }
  if (document.location.hash === '#json') {
    return <pre>{JSON.stringify(json, null, 2)}</pre>
  }
  let selected
  if (loading) {
    selected = 'Loading...'
  } else if (!selectedMiner) {
    selected = 'No miner selected.'
  } else {
    selected = (
      <div
        style={{
          display: 'flex',
          fontSize: 'small',
          marginTop: '0.8rem',
          flexWrap: 'wrap'
        }}
      >
        Selected Miner: {selectedMiner}
        <a
          href={`https://spacegap.github.io/#/miners/${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Spacegap
        </a>
        <a
          href={`https://filfox.info/en/address/${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Filfox
        </a>
        <a
          href={`https://filscan.io/#/tipset/address-detail?address=${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Filscan
        </a>
        <a
          href={`https://filscout.io/en/pc/miner?id=${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          FILscout
        </a>
        <a
          href={`https://filplorer.com/miner/${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Filplorer
        </a>
        <a
          href={`https://1475ipfs.com/blockBrowserDetail?comName=minerDetail&minerAddress=${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          1475
        </a>
        <a
          href={`https://filecoin.tools/${selectedMiner}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          CID Checker
        </a>
        <a
          href={`https://www.storage.codefi.network/details/${codefiAskId}`}
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Codefi
        </a>
        <a
          href='https://filstats.com/'
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          FilStats
        </a>
        <a
          href='https://filstats.io/'
          target='_blank'
          style={{ marginLeft: '0.5rem' }}
        >
          Filstats.io
        </a>
      </div>
    )
  }
  // You can also the use the stringified config values as attributes
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '95vh' }}>
      {selected}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          margin: '3px',
          fontSize: 'small'
        }}
      >
        [
        <a href='https://github.com/jimpick/perspective-filecoin-asks'>
          GitHub
        </a>{' '}
        | <a href='#csv'>CSV</a> {' | '}
        <a href='#json'>JSON</a>]
      </div>
      <div style={{ position: 'relative', flex: '1' }}>
        <perspective-viewer
          ref={viewer} /*row-pivots='["State"]'*/
        ></perspective-viewer>
      </div>
    </div>
  )
}
window.addEventListener('load', () => {
  ReactDOM.render(<App />, document.getElementById('root'))
})
