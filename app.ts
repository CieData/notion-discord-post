import fetch from 'node-fetch';
import {Client,isFullPageOrDatabase,isFullBlock} from '@notionhq/client';

/**
 * 디스코드 메시지를 나타내는 인터페이스
 */
interface DiscordMessage  {
  content : string 
}
/**
 * 메시지 예약 데이터베이스 ID와 디스코드 웹훅 링크가 있는 객체 인터페이스 
 */
interface LinkObject {
  databaseId:string,
  webhookUrl:string
}

if (process.env.NOTION_TOKEN === undefined) {
  throw new Error("노션 API 토큰을 환경변수에서 읽을 수 없습니다.");
}
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
})

/**
 * 웹훅으로 디스코드 채널에 메시지를 보내는 함수
 * @param webhookUrl - 디스코드 웹훅 주소 URL
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
 * 노션 데이터베이스 URL에서 데이터베이스 ID만 추출해서 반환하는 함수 
 * @param databaseURL 노션 데이터베이스 (보기)링크(URL)
 * @returns databaseId 노션 데이터베이스 ID
 */
const parseDatabaseId = (databaseURL : string) => {
  const databaseIdObject = /[a-z0-9]+\?v/.exec(databaseURL);
  if (databaseIdObject === null) {
    throw new Error("노션 데이터 베이스 ID를 찾을 수 없습니다.");
  }
  const databaseId = databaseIdObject[0].split("\?v")[0];
  return databaseId; 
}

/**
 * 노션에 있는 링크 관리 데이터베이스에서 노션 DB-디스코드 웹훅 연결 정보 객체를 가져오는 함수
 * @param linkDatabaseId - 노션 데이터베이스 ID
 */
const getLinkObjectArray = async (linkDatabaseId : string) => {
  const response = await notion.databases.query({
    database_id: linkDatabaseId
  });
  let linkObjectArray:LinkObject[] = [];
  for (const linkPage of response.results) {
    if (!isFullPageOrDatabase(linkPage)) {
      continue;
    }
    if (!("rich_text" in linkPage.properties["디스코드 웹훅 URL"])) {
      continue;
    }
    if (!("rich_text" in linkPage.properties["노션 데이터베이스 링크"])) {
      continue;
    } 
    const databaseURLObject = linkPage.properties["노션 데이터베이스 링크"].rich_text.at(0);
    if (databaseURLObject === undefined) {
      continue;
    }
    const webhookURLObject = linkPage.properties["디스코드 웹훅 URL"].rich_text.at(0);
    if (webhookURLObject === undefined) {
      continue;
    }
    const databaseURL = databaseURLObject.plain_text;
    const databaseId = parseDatabaseId(databaseURL);
    const webhookURL = webhookURLObject.plain_text;
    linkObjectArray.push({webhookUrl:webhookURL,databaseId:databaseId});
  }
  return linkObjectArray;
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

/**
 * 모든 노션 데이터베이스의 예약된 메시지를 전송하는 함수  
 * @param linkDatabaseId 링크 노션 데이터베이스 ID
 */
const sendAllReservedMessages = async (linkDatabaseId :string) => {
  const linkObjectArray:LinkObject[] = await getLinkObjectArray(linkDatabaseId);
  for (const linkObject of linkObjectArray) {
    await sendReservedMessages(linkObject.databaseId,linkObject.webhookUrl);
  }    
} 
/**
 * 예약 메시지 데이터베이스에 있는 예약된 메시지를 디스코드 웹훅으로 전송하는 함수
 * @param databaseId 예약 메시지 데이터베이스 ID
 * @param webhookUrl 디스코드 웹훅 URL 주소
 */
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
    let reservedTime = new Date(messagePage.properties["예약 시간"].date.start);
    reservedTime.setUTCHours(reservedTime.getHours() + 9);
    let nowTime = new Date()
    nowTime.setUTCHours(nowTime.getUTCHours() + 9);
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
        console.log(`입력 내용 : ${messageContent}`);
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
    console.log(`발송 성공! 예정 시간 : ${reservedTime}, 현재 시간 : ${nowTime}`);

  }
};

try {
  if (process.env.LINK_DATABASE_URL === undefined) {
    throw new Error("노션 - 디스코드 링크 데이터베이스 URL을 환경변수에서 읽을 수 없습니다.");
  }
  const linkDatabaseUrl : string = process.env.LINK_DATABASE_URL;
  sendAllReservedMessages(parseDatabaseId(linkDatabaseUrl)); 
} catch (error) {
  console.error(error);  
}
