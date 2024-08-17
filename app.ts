import fetch from 'node-fetch';
import {Client,isFullPageOrDatabase,isFullBlock} from '@notionhq/client';

if (process.env.NOTION_TOKEN === undefined) {
  throw new Error("노션 API 토큰을 환경변수에서 읽을 수 없습니다.");
}
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
})

interface DiscordMessage  {
  content : string 
}

/**
 * 웹훅으로 디스코드 채널에 메시지를 보내는 함수
 * @param webhookUrl - 디스코드 웹훕 주소 URL
 * @param message - 디스코드 메시지 객체
 */
const sendMessage = async (webhookUrl : string, message : DiscordMessage) => {
  await fetch( 
    webhookUrl,
    {
      method:"POST", 
      headers :{"Content-Type" : "application/json"}, 
      body : JSON.stringify(message)
    }
  );
}

/**
 * 노션에 있는 데이터베이스에서 메시지가 담겨있는 페이지들을 가져와서 반환하는 함수
 * @param databaseId - 노션 데이터베이스 ID
 */
const getReservedMessages = async (databaseId : string) => {
  const response = await notion.databases.query({ 
    database_id: databaseId,
    "filter": {
      "property": "발송 상태",
      "select": {
        "equals": "발송 예정"
      }
    }
  });
  return response.results;
} 

const sendReservedMessages = async (databaseId:string, webhookUrl:string) => {
  for (let messagePage of await getReservedMessages(databaseId))
  {
    if (!isFullPageOrDatabase(messagePage)) {
      continue
    }
    // 예약 시간 속성에 date 속성이 있지 않다면 넘어가기
    if (!("date" in messagePage.properties["예약 시간"])) {
      continue;
    }
    // 예약 시간이 설정 되지 않았을 경우 넘어가기
    if (messagePage.properties["예약 시간"].date === null) {
      continue;
    }

    // 예약된 시간이 지나지 않은 메세지일 경우 발송하지 않고 넘어가기
    const reservedTime = new Date(messagePage.properties["예약 시간"].date.start);
    const nowTime = new Date(); 
    if (reservedTime > nowTime) continue;
    
    // 예약된 메시지 페이지에 있는 블럭들을 가져오기 
    const blocks = await notion.blocks.children.list(
      {block_id : messagePage.id} 
    )
    for (const block of blocks.results) {
      if (!isFullBlock(block)) continue;
      
      // code 블럭이 아닌 블럭일 경우 무시하기
      if(block.type !== "code") continue;
      
      const blockType = block.type
      if (block[blockType].rich_text.length > 0) {
        const messageContent = block[blockType].rich_text[0].plain_text;
        // 디스코드 서버에 웹훅으로 메시지 전송
        await sendMessage(webhookUrl,{content:messageContent})
        // 메시지 발송 완료 후 노션 데이터베이스 발송 상태를 발송 완료로 변경
        await notion.pages.update({
          page_id : messagePage.id,
          properties : {
            "발송 상태" : {
              select : {
                "name" : "발송 완료"
              }
            }
          } 
        })
      }
    }
  }
};

try {
  if (process.env.DATABASE_ID === undefined) {
    throw new Error("노션 데이터베이스 ID를 환경변수에서 읽을 수 없습니다.");
  }
  if (process.env.WEBHOOK_URL === undefined) {
    throw new Error("디스코드 웹훅 URL 주소를 환경변수에서 읽을 수 없습니다.");
  }
  const databaseId : string = process.env.DATABASE_ID;
  const webhookUrl : string = process.env.WEBHOOK_URL; 
  sendReservedMessages(databaseId,webhookUrl); 
} catch (error) {
  console.error(error);  
}