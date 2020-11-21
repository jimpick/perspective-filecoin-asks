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
import delay from 'delay'
// import { mainnet } from '@filecoin-shipyard/lotus-client-schema'
// import { BrowserProvider } from '@filecoin-shipyard/lotus-client-provider-browser'
// import { LotusRPC } from '@filecoin-shipyard/lotus-client-rpc'
// import delay from 'delay'

const worker = perspective.shared_worker()

interface MinerRecord {
  minerNum: number
  miner: string
  askStatus?: string
  codefiPriceRaw: string
  codefiPriceValue: number
  codefiPriceUsd: number
  codefiScore: number
  annotationState: string
  annotationExtra: string
  stored: boolean
  retrieved: boolean
  codefiMinPieceSize: number
  codefiMaxPieceSize: number
  codefiAskId: string
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
      askStatus: null,
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
      codefiMinPieceSize,
      codefiMaxPieceSize,
      codefiAskId
    }
  })
  return data
}

const config: PerspectiveViewerOptions = {
  columns: [
    'minerNum',
    'miner',
    'askStatus',
    'codefiPriceRaw',
    'codefiPriceValue',
    'codefiPriceUsd',
    'codefiScore',
    'annotationState',
    'annotationExtra',
    'stored',
    'retrieved',
    'codefiMinPieceSize',
    'codefiMaxPieceSize'
  ],
  // 'row-pivots': ['State']
  filters: [
    ['retrieved', '==', 'true'],
    ['stored', '==', 'true']
    // ['codefiAskId', 'is not null', '']
  ],
  sort: [
    // ['priceRaw', 'asc'],
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
      const table = worker.table(data, { index: 'miner' })
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
      setLoading(false)
      while (true) {
        const view = table.view({
          columns: ['miner', 'askStatus'],
          filter: [['askStatus', 'is null', '']],
          sort: [
            ['stored', 'desc'],
            ['retrieved', 'desc'],
            ['minerNum', 'asc']
          ]
        })
        const dataAskCandidates = (await view.to_json()) as MinerRecord[]
        console.log('Jim dataAskCandidates', dataAskCandidates.length)
        if (dataAskCandidates.length > 0) {
          const { miner } = dataAskCandidates[0]
          for (let i in data) {
            const record = data[i]
            if (record.miner === miner) {
              // record.askStatus = String(Date.now())
              console.log('Jim updating', miner)
              table.update({
                miner: [miner],
                askStatus: [String(Date.now())]
              } as any)
            }
          }
        }
        await delay(1000)
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
